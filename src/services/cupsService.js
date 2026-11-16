'use strict';

const config = require('../config');
const { run, runSafe } = require('../utils/command');
const ipp = require('../utils/ipptool');
const logger = require('../utils/logger');

/** IPP job-state 枚举 -> 统一状态 */
const JOB_STATE_MAP = {
  pending: { state: 'pending', label: '等待中', code: 3 },
  held: { state: 'held', label: '已暂停', code: 4 },
  processing: { state: 'processing', label: '打印中', code: 5 },
  stopped: { state: 'stopped', label: '出错停止', code: 6 },
  canceled: { state: 'cancelled', label: '已取消', code: 7 },
  aborted: { state: 'aborted', label: '已中止', code: 8 },
  completed: { state: 'completed', label: '已完成', code: 9 },
};

/** IPP printer-state 枚举 -> 统一状态 */
const PRINTER_STATE_MAP = {
  idle: { state: 'idle', label: '空闲', code: 3 },
  processing: { state: 'processing', label: '打印中', code: 4 },
  stopped: { state: 'stopped', label: '已停止', code: 5 },
};

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从 lpstat -a 的输出行里解析打印机名
 * 兼容中文（"正在接受请求"）与英文（"accepting requests"）
 */
function parsePrinterName(line) {
  const m = line.match(/^(\S+?)\s*(?:正在|accepting|Accepting|not accepting|已禁用|disabled|Disabled|接受请求)/);
  if (m && m[1]) return m[1].trim();
  const fallback = line.trim().split(/\s+/)[0];
  return fallback || null;
}

/** 获取所有打印机名称 */
async function listPrinterNames() {
  const res = await runSafe(config.cups.lpstat, ['-a']);
  if (!res) throw new Error('无法获取打印机列表（lpstat -a 执行失败）');
  const names = [];
  const seen = new Set();
  for (const line of (res.stdout + res.stderr).split('\n')) {
    if (!line.trim()) continue;
    const name = parsePrinterName(line);
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** 获取 CUPS 默认打印机名 */
async function getDefaultPrinterName() {
  const res = await runSafe(config.cups.lpstat, ['-d']);
  if (!res) return null;
  const text = res.stdout + res.stderr;
  // 中文："系统默认目的位置：HWGPRINT"（全角冒号） 英文："system default destination: HWGPRINT"
  const m = text.match(/[:：]\s*(\S+)\s*$/m);
  return m ? m[1].trim() : null;
}

/** 获取 CUPS 调度程序是否运行 */
async function isSchedulerRunning() {
  const res = await runSafe(config.cups.lpstat, ['-r']);
  if (!res) return false;
  const text = res.stdout + res.stderr;
  return /running|正在运行/i.test(text);
}

/** 查询单台打印机详情（IPP 结构化数据） */
async function getPrinter(name, defaultName) {
  const result = await ipp.getPrinterAttributes(name);
  const a = result.attributes || {};
  const stateInfo = PRINTER_STATE_MAP[a['printer-state']] || {
    state: a['printer-state'] || 'unknown',
    label: a['printer-state'] || '未知',
    code: 0,
  };
  const pageSize = typeof a['media-default'] === 'string' ? a['media-default'] : null;
  return {
    name,
    isDefault: defaultName ? name === defaultName : false,
    state: stateInfo.state,
    stateLabel: stateInfo.label,
    stateCode: stateInfo.code,
    stateReasons: a['printer-state-reasons'] || [],
    stateMessage: a['printer-state-message'] || '',
    acceptingJobs: a['printer-is-accepting-jobs'] !== false,
    info: a['printer-info'] || '',
    location: a['printer-location'] || '',
    makeModel: a['printer-make-and-model'] || '',
    deviceUri: a['device-uri'] || '',
    uri: config.cups.ippBaseUri + '/' + encodeURIComponent(name),
    queuedJobs: typeof a['queued-job-count'] === 'number' ? a['queued-job-count'] : 0,
    defaultPageSize: pageSize,
    supportedFormats: a['document-format-supported'] || [],
    uptimeSeconds: a['printer-up-time'] || 0,
    reachable: result.ok,
  };
}

/** 列出所有打印机（含状态） */
async function listPrinters() {
  const names = await listPrinterNames();
  const defaultName = await getDefaultPrinterName();
  const printers = await Promise.all(
    names.map((name) => getPrinter(name, defaultName).catch((err) => {
      logger.error(`查询打印机 ${name} 失败:`, err.message);
      return {
        name,
        isDefault: name === defaultName,
        state: 'unknown',
        stateLabel: '未知',
        reachable: false,
        error: err.message,
      };
    }))
  );
  // 默认打印机排在最前
  printers.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  return printers;
}

/** 打印选项白名单 -> lp -o 参数 */
function buildOptionArgs(options = {}) {
  const args = [];
  const add = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    args.push('-o', `${key}=${value}`);
  };

  // 纸张尺寸
  if (options.media || options.pageSize) add('media', options.media || options.pageSize);
  // 双面打印
  if (options.sides) {
    const map = {
      'one-sided': 'one-sided',
      duplex: 'two-sided-long-edge',
      'two-sided-long-edge': 'two-sided-long-edge',
      'two-sided-short-edge': 'two-sided-short-edge',
      longedge: 'two-sided-long-edge',
      shortedge: 'two-sided-short-edge',
    };
    add('sides', map[options.sides] || options.sides);
  } else if (options.duplex === true) {
    add('sides', 'two-sided-long-edge');
  }
  // 彩色/黑白
  if (options.color === false || options.monochrome === true) add('print-color-mode', 'monochrome');
  else if (options.color === true) add('print-color-mode', 'color');
  // 方向
  if (options.orientation) {
    const map = { portrait: 3, landscape: 4, 'reverse-landscape': 5, 'reverse-portrait': 6 };
    add('orientation-requested', map[options.orientation] || options.orientation);
  }
  // 打印质量
  if (options.quality) {
    const map = { draft: 3, normal: 4, high: 5 };
    add('print-quality', map[options.quality] || options.quality);
  }
  // 缩放/多合一
  if (options.numberUp) add('number-up', options.numberUp);
  if (options.fitToPage === true) args.push('-o', 'fit-to-page');
  // 页码范围
  if (options.pageRanges) add('page-ranges', options.pageRanges);
  // 水印
  if (options.jobSheets) add('job-sheets', options.jobSheets);
  // 原样打印（不经过 CUPS 过滤器）
  if (options.raw === true) args.push('-o', 'raw');
  // 其他自定义 -o 参数（白名单字符，防止异常输入）
  if (options.extra && typeof options.extra === 'object') {
    for (const [k, v] of Object.entries(options.extra)) {
      if (/^[a-zA-Z][\w-]*$/.test(k) && /^[\w .,@/-]+$/.test(String(v))) add(k, v);
    }
  }
  return args;
}

/**
 * 提交打印任务
 * @returns {Promise<{cupsId, printer, rawOutput}>}
 */
async function submitJob({ printer, filePath, title, copies, options }) {
  const args = ['-d', printer];
  if (copies && Number.isInteger(copies) && copies > 0) args.push('-n', String(copies));
  if (title) args.push('-t', String(title));
  args.push(...buildOptionArgs(options));
  args.push(filePath);

  logger.info(`提交打印: lp ${args.slice(0, -1).join(' ')} <file>`);
  let res;
  try {
    res = await run(config.cups.lp, args, { timeout: 30000 });
  } catch (err) {
    const detail = ((err.stderr || '') + (err.stdout || '')).trim();
    const wrapped = new Error('打印机拒绝任务' + (detail ? ': ' + detail : ''));
    wrapped.code = 'PRINT_SUBMIT_FAILED';
    throw wrapped;
  }
  const output = (res.stdout + res.stderr).trim();

  // 解析 job id：中文"请求id是HWGPRINT-30" / 英文"request id is HWGPRINT-30"
  // 以已知打印机名做锚点，避免把中文前缀"请求id是"也包含进去
  let cupsId = null;
  const anchored = output.match(new RegExp(escapeRegExp(printer) + '-(\\d+)'));
  if (anchored) {
    cupsId = `${printer}-${anchored[1]}`;
  } else {
    const tokens = output.match(/[A-Za-z0-9_.-]+-\d+/g) || [];
    cupsId = tokens[0] || null;
  }

  if (!cupsId) {
    logger.warn(`未能从 lp 输出解析任务号，输出: ${output}`);
    throw new Error('已提交打印，但无法解析 CUPS 任务号: ' + output);
  }
  const numericId = Number.parseInt(cupsId.split('-').pop(), 10);
  return { cupsId, numericId, printer, rawOutput: output };
}

/** 取消 CUPS 任务 */
async function cancelJob(cupsId) {
  if (!/^[\w\u4e00-\u9fa5.-]+-\d+$/.test(cupsId)) {
    throw new Error('非法的任务号: ' + cupsId);
  }
  const res = await run(config.cups.cancel, [cupsId], { timeout: 10000 });
  return { cupsId, output: (res.stdout + res.stderr).trim() };
}

/** 查询 CUPS 任务状态 */
async function getJobStatus(printer, cupsId) {
  // ipp.getJobAttributes 内部按数字解析，这里先提取末尾数字部分
  const numericId = String(cupsId).split('-').pop();
  const result = await ipp.getJobAttributes(printer, numericId);
  const a = result.attributes || {};
  const rawState = a['job-state'];
  const stateInfo = JOB_STATE_MAP[rawState] || {
    state: rawState || 'unknown',
    label: rawState || '未知',
    code: 0,
  };
  return {
    found: result.ok,
    cupsId,
    printer,
    state: stateInfo.state,
    stateLabel: stateInfo.label,
    stateCode: stateInfo.code,
    stateReasons: a['job-state-reasons'] || [],
    jobName: a['job-name'] || '',
    user: a['job-originating-user-name'] || '',
    sizeKB: a['job-k-octets'] || 0,
    impressions: a['job-impressions'] || 0,
    copies: a['copies'] || 1,
    media: a['media'] || '',
    sides: a['sides'] || '',
    createdAt: a['time-at-creation'] ? new Date(a['time-at-creation'] * 1000).toISOString() : null,
    processingAt: a['time-at-processing'] ? new Date(a['time-at-processing'] * 1000).toISOString() : null,
    completedAt: a['time-at-completed'] ? new Date(a['time-at-completed'] * 1000).toISOString() : null,
  };
}

/** 解析 lpstat -o 的任务列表 */
function parseCupsJobList(text) {
  const jobs = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const cupsId = parts[0];
    if (!/^[\w\u4e00-\u9fa5.-]+-\d+$/.test(cupsId)) continue;
    const sizeBytes = Number.parseInt(parts[2], 10);
    jobs.push({
      cupsId,
      user: parts[1],
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      submittedAtText: parts.slice(3).join(' '),
    });
  }
  return jobs;
}

/** 列出 CUPS 任务队列（which: all | not-completed | completed） */
async function listCupsJobs(printer, which = 'all') {
  const args = ['-W', which, '-o'];
  if (printer) args.push(printer);
  const res = await runSafe(config.cups.lpstat, args);
  if (!res) return [];
  return parseCupsJobList(res.stdout + res.stderr);
}

/** 获取打印机可用选项（lpoptions -l） */
async function getPrinterOptions(name) {
  const res = await runSafe(config.cups.lpoptions, ['-p', name, '-l']);
  if (!res) return [];
  const text = res.stdout + res.stderr;
  const options = [];
  for (const line of text.split('\n')) {
    // 形如 "PageSize/Paper Size: A4 *Letter Legal" 或 "Duplex/Two-Sided: ... *None"
    const m = line.match(/^([\w-]+)\/([^:]+):\s*(.+)$/);
    if (!m) continue;
    const [, key, displayName, valuesStr] = m;
    const values = valuesStr.trim().split(/\s+/).map((v) => ({
      value: v.replace(/^\*/, ''),
      isDefault: v.startsWith('*'),
    }));
    options.push({ key, displayName: displayName.trim(), values });
  }
  return options;
}

module.exports = {
  listPrinters,
  listPrinterNames,
  getPrinter,
  getDefaultPrinterName,
  isSchedulerRunning,
  submitJob,
  cancelJob,
  getJobStatus,
  listCupsJobs,
  getPrinterOptions,
  parsePrinterName,
  parseCupsJobList,
  JOB_STATE_MAP,
  PRINTER_STATE_MAP,
};
