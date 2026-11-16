'use strict';

const config = require('../config');
const { ps, psSafe, psJson } = require('../utils/winCommand');
const logger = require('../utils/logger');

/** Windows JobStatus -> 统一状态 */
const JOB_STATE_MAP = {
  Queued: { state: 'pending', label: '等待中', code: 3 },
  Waiting: { state: 'pending', label: '等待中', code: 3 },
  Restarted: { state: 'pending', label: '等待中', code: 3 },
  Printing: { state: 'processing', label: '打印中', code: 5 },
  Paused: { state: 'held', label: '已暂停', code: 4 },
  Complete: { state: 'completed', label: '已完成', code: 9 },
  Retained: { state: 'completed', label: '已完成', code: 9 },
  Error: { state: 'stopped', label: '出错停止', code: 6 },
  Deleting: { state: 'cancelled', label: '已取消', code: 7 },
  Unknown: { state: 'unknown', label: '未知', code: 0 },
};

/** Windows PrinterStatus -> 统一状态 */
const PRINTER_STATE_MAP = {
  Normal: { state: 'idle', label: '空闲', code: 3 },
  Idle: { state: 'idle', label: '空闲', code: 3 },
  Printing: { state: 'processing', label: '打印中', code: 4 },
  Busy: { state: 'processing', label: '打印中', code: 4 },
  IOActive: { state: 'processing', label: '打印中', code: 4 },
  Paused: { state: 'stopped', label: '已停止', code: 5 },
  Error: { state: 'stopped', label: '已停止', code: 5 },
  Offline: { state: 'stopped', label: '已停止', code: 5 },
  NotAvailable: { state: 'stopped', label: '已停止', code: 5 },
  PaperJam: { state: 'stopped', label: '卡纸', code: 5 },
  PaperOut: { state: 'stopped', label: '缺纸', code: 5 },
  ManualFeed: { state: 'stopped', label: '需手动进纸', code: 5 },
  PendingDeletion: { state: 'stopped', label: '待删除', code: 5 },
  WarmingUp: { state: 'processing', label: '预热中', code: 4 },
  Starting: { state: 'processing', label: '启动中', code: 4 },
  Initializing: { state: 'processing', label: '初始化中', code: 4 },
  Waiting: { state: 'idle', label: '空闲', code: 3 },
  Unknown: { state: 'unknown', label: '未知', code: 0 },
};

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** PowerShell 单引号字符串转义 */
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/** 获取打印后台服务(Spooler)是否运行 */
async function isSchedulerRunning() {
  const res = await psSafe('(Get-Service -Name Spooler -ErrorAction SilentlyContinue).Status');
  if (!res) return false;
  return /Running/i.test(res.stdout);
}

/** 获取所有打印机名称 */
async function listPrinterNames() {
  const script = `
    $names = @(Get-Printer -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    $names | ConvertTo-Json -Compress
  `;
  const data = await psJson(script);
  return asArray(data);
}

/** 获取默认打印机名 */
async function getDefaultPrinterName() {
  const script = `
    $d = Get-CimInstance -ClassName Win32_Printer -ErrorAction SilentlyContinue | Where-Object { $_.Default } | Select-Object -First 1
    if ($d) { Write-Output ("__DEFAULT__" + $d.Name) }
  `;
  const res = await psSafe(script);
  if (!res) return null;
  const m = res.stdout.match(/__DEFAULT__(.+)\s*$/m);
  return m ? m[1].trim() : null;
}

/** 查询单台打印机详情 */
async function getPrinter(name, defaultName) {
  const safeName = psQuote(name);
  const script = `
    $p = Get-Printer -Name ${safeName} -ErrorAction SilentlyContinue
    if (-not $p) { Write-Output '{}'; exit }
    $jobs = @(Get-PrintJob -PrinterName ${safeName} -ErrorAction SilentlyContinue).Count
    $cfg = Get-CimInstance -ClassName Win32_PrinterConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq ${safeName} } | Select-Object -First 1
    $obj = [ordered]@{
      name = $p.Name
      driverName = $p.DriverName
      portName = $p.PortName
      printerStatus = [string]$p.PrinterStatus
      shared = [bool]$p.Shared
      location = [string]$p.Location
      comment = [string]$p.Comment
      type = [string]$p.Type
      jobCount = $jobs
      paperSize = if ($cfg) { [string]$cfg.PaperSize } else { '' }
      color = if ($cfg) { [bool]$cfg.Color } else { $false }
      duplex = if ($cfg) { [int]$cfg.Duplex } else { 0 }
    }
    $obj | ConvertTo-Json -Compress
  `;
  const data = await psJson(script);
  if (!data || !data.name) {
    return { name, reachable: false, state: 'unknown', stateLabel: '未知' };
  }
  const stateInfo = PRINTER_STATE_MAP[data.printerStatus] || {
    state: 'unknown', label: data.printerStatus || '未知', code: 0,
  };
  return {
    name: data.name,
    isDefault: defaultName ? data.name === defaultName : false,
    state: stateInfo.state,
    stateLabel: stateInfo.label,
    stateCode: stateInfo.code,
    stateReasons: [],
    stateMessage: '',
    acceptingJobs: data.printerStatus !== 'Paused',
    info: data.comment || data.name,
    location: data.location || '',
    makeModel: data.driverName || '',
    deviceUri: data.portName || '',
    uri: 'winspool://printers/' + encodeURIComponent(name),
    queuedJobs: Number(data.jobCount) || 0,
    defaultPageSize: data.paperSize || null,
    shared: !!data.shared,
    supportedFormats: (config.allowedFormats && Object.keys(config.allowedFormats)) || [],
    driverName: data.driverName || '',
    portName: data.portName || '',
    reachable: true,
  };
}

/** 列出所有打印机（含状态） */
async function listPrinters() {
  const names = await listPrinterNames();
  const defaultName = await getDefaultPrinterName();
  const printers = await Promise.all(
    names.map((name) => getPrinter(name, defaultName).catch((err) => {
      logger.error(`查询打印机 ${name} 失败:`, err.message);
      return { name, isDefault: name === defaultName, state: 'unknown', stateLabel: '未知', reachable: false, error: err.message };
    }))
  );
  printers.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  return printers;
}

/** 构建打印选项 PowerShell 片段（用于 COM/DEVMODE） */
function buildPrintOptions(options = {}) {
  // 返回一段 PowerShell 代码字符串，设置 $devmode 相关属性；复杂选项在 COM 提交时使用
  const lines = [];
  if (options.pageSize || options.media) lines.push(`$dev.PaperSize = ${psQuote(options.pageSize || options.media)}`);
  if (options.copies) lines.push(`$copies = ${Number(options.copies) || 1}`);
  return lines.join('\n');
}

/**
 * 提交打印任务。
 * 策略：
 *  - Office 文档(.doc/.docx/.xls/.xlsx/.ppt/.pptx)：用 COM 自动化调用对应应用 PrintOut
 *  - 文本类(.txt/.log/.csv)：用 Get-Content | Out-Printer
 *  - PDF/图片/PostScript：用 Start-Process -Verb Print（交给系统关联程序）
 *  - 也可通过 win.printTool 强制指定外部工具（如 PDFtoPrinter / SumatraPDF）
 */
async function submitJob({ printer, filePath, title, copies = 1, options = {}, ext }) {
  const safePrinter = psQuote(printer);
  const safeFile = psQuote(filePath);
  const safeTitle = psQuote(title || '');
  const copiesNum = Number(copies) || 1;

  let script;
  const lower = String(ext || '').toLowerCase();

  const officeWord = ['.doc', '.docx', '.rtf', '.odt'];
  const officeExcel = ['.xls', '.xlsx', '.ods'];
  const officePpt = ['.ppt', '.pptx', '.odp'];

  if (officeWord.includes(lower) || officeExcel.includes(lower) || officePpt.includes(lower)) {
    let appVar, docsVar, openArgs, appProgId;
    if (officeWord.includes(lower)) {
      appProgId = 'Word.Application'; appVar = '$word'; docsVar = '$word.Documents';
      openArgs = `${safeFile}, $false, $true`; // ConfirmConversions, ReadOnly
    } else if (officeExcel.includes(lower)) {
      appProgId = 'Excel.Application'; appVar = '$excel'; docsVar = '$excel.Workbooks';
      openArgs = `${safeFile}`;
    } else {
      appProgId = 'PowerPoint.Application'; appVar = '$ppt'; docsVar = '$ppt.Presentations';
      openArgs = `${safeFile}`;
    }
    script = `
      $ErrorActionPreference = 'Stop'
      ${appVar} = New-Object -ComObject ${appProgId}
      try {
        ${appVar}.Visible = $false
        ${appVar}.DisplayAlerts = $false
        $doc = ${docsVar}.Open(${openArgs})
        $doc.PrintOut([ref]$false, [ref]$false, [ref]${copiesNum})
        $doc.Close($false)
        Write-Output 'SUBMITTED by COM'
      } finally {
        ${appVar}.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject(${appVar}) | Out-Null
      }
    `;
  } else if (['.txt', '.log', '.csv'].includes(lower)) {
    script = `
      $ErrorActionPreference = 'Stop'
      $content = Get-Content -Path ${safeFile} -Raw -ErrorAction Stop
      $content | Out-Printer -Name ${safePrinter}
      Write-Output 'SUBMITTED by Out-Printer'
    `;
  } else {
    // PDF / 图片 / PostScript：优先使用外部打印工具（如 PDFtoPrinter / SumatraPDF），否则用 Shell Print 动词
    const tool = config.win.printTool;
    if (tool && tool !== 'auto') {
      // 外部工具：{tool} "printer" "file"
      const safeTool = psQuote(tool);
      script = `
        $ErrorActionPreference = 'Stop'
        & ${safeTool} ${safePrinter} ${safeFile} 2>&1 | Out-Null
        Write-Output 'SUBMITTED by external tool'
      `;
    } else {
      script = `
        $ErrorActionPreference = 'Stop'
        Start-Process -FilePath ${safeFile} -Verb Print -WindowStyle Hidden -ErrorAction Stop
        Start-Sleep -Milliseconds 500
        Write-Output 'SUBMITTED by Shell Print verb'
      `;
    }
  }

  logger.info(`Windows 提交打印: ${printer} <- ${filePath} (${lower}, copies=${copiesNum})`);
  let res;
  try {
    res = await ps(script, { timeout: config.win.printTimeout || 60000 });
  } catch (err) {
    const detail = ((err.stderr || '') + (err.stdout || '')).trim();
    const wrapped = new Error('打印提交失败' + (detail ? ': ' + detail : ''));
    wrapped.code = 'PRINT_SUBMIT_FAILED';
    throw wrapped;
  }

  // Shell Print / COM 不直接返回任务号，用文档名匹配 Get-PrintJob 找出新任务
  const cupsId = await findJobByTitle(printer, title);
  return {
    cupsId: cupsId || `${printer}-0`,
    numericId: cupsId ? Number.parseInt(cupsId.split('-').pop(), 10) : 0,
    printer,
    rawOutput: (res.stdout + res.stderr).trim(),
  };
}

/** 按文档名在打印队列中查找任务号 */
async function findJobByTitle(printer, title) {
  if (!title) return null;
  const safePrinter = psQuote(printer);
  const safeTitle = psQuote(title);
  const script = `
    $j = Get-PrintJob -PrinterName ${safePrinter} -ErrorAction SilentlyContinue |
         Where-Object { $_.DocumentName -like "*${String(title).replace(/[\[\]*?]/g, '')}*" } |
         Sort-Object SubmittedTime -Descending | Select-Object -First 1
    if ($j) { Write-Output ("__JOB__" + $j.ID) }
  `;
  const res = await psSafe(script);
  if (!res) return null;
  const m = res.stdout.match(/__JOB__(\d+)/);
  return m ? `${printer}-${m[1]}` : null;
}

/** 取消打印任务 */
async function cancelJob(cupsId) {
  const m = String(cupsId).match(/^(.+)-(\d+)$/);
  if (!m) throw new Error('非法的任务号: ' + cupsId);
  const printer = m[1], id = m[2];
  const script = `
    $ErrorActionPreference = 'Stop'
    Remove-PrintJob -PrinterName ${psQuote(printer)} -ID ${Number(id)}
    Write-Output 'CANCELLED'
  `;
  const res = await ps(script, { timeout: 15000 });
  return { cupsId, output: (res.stdout + res.stderr).trim() };
}

/** 查询任务状态 */
async function getJobStatus(printer, cupsId) {
  const m = String(cupsId).match(/^(.+)-(\d+)$/);
  const numericId = m ? m[2] : String(cupsId).split('-').pop();
  const safePrinter = psQuote(printer);
  const script = `
    $j = Get-PrintJob -PrinterName ${safePrinter} -ID ${Number(numericId)} -ErrorAction SilentlyContinue
    if ($j) {
      [ordered]@{
        found = $true
        jobId = $j.ID
        jobName = [string]$j.DocumentName
        user = [string]$j.UserName
        jobState = [string]$j.JobStatus
        sizeKB = [math]::Round($j.Size / 1KB, 0)
        submittedAt = [string]$j.SubmittedTime
        printerName = [string]$j.PrinterName
      } | ConvertTo-Json -Compress
    } else {
      [ordered]@{ found = $false } | ConvertTo-Json -Compress
    }
  `;
  const data = await psJson(script);
  if (!data || !data.found) {
    // 任务不在队列中：通常意味着已完成/已取消
    return {
      found: false, cupsId, printer,
      state: 'completed', stateLabel: '已完成', stateCode: 9,
      stateReasons: [], completedAt: new Date().toISOString(),
    };
  }
  const stateInfo = JOB_STATE_MAP[data.jobState] || { state: 'unknown', label: data.jobState, code: 0 };
  return {
    found: true,
    cupsId,
    printer,
    state: stateInfo.state,
    stateLabel: stateInfo.label,
    stateCode: stateInfo.code,
    stateReasons: data.jobState ? [data.jobState] : [],
    jobName: data.jobName || '',
    user: data.user || '',
    sizeKB: Number(data.sizeKB) || 0,
    impressions: 0,
    copies: 1,
    media: '',
    sides: '',
    createdAt: data.submittedAt || null,
    processingAt: null,
    completedAt: stateInfo.state === 'completed' ? new Date().toISOString() : null,
  };
}

/** 列出打印队列任务 */
async function listCupsJobs(printer, which = 'all') {
  const safePrinter = psQuote(printer);
  const filterMap = {
    'not-completed': `$_ | Where-Object { $_.JobStatus -notin @('Complete','Retained') }`,
    completed: `$_ | Where-Object { $_.JobStatus -in @('Complete','Retained') }`,
    all: '$_',
  };
  const filter = filterMap[which] || filterMap.all;
  const script = `
    $jobs = @(Get-PrintJob -PrinterName ${safePrinter} -ErrorAction SilentlyContinue | ForEach-Object { ${filter} } | ForEach-Object {
      [ordered]@{
        cupsId = ("${printer}-" + $_.ID)
        user = [string]$_.UserName
        name = [string]$_.DocumentName
        status = [string]$_.JobStatus
        sizeBytes = [int64]$_.Size
        submittedAtText = [string]$_.SubmittedTime
      }
    })
    $jobs | ConvertTo-Json -Compress -Depth 4
  `;
  const data = await psJson(script);
  return asArray(data);
}

/** 获取打印机可用选项（从 Win32_PrinterConfiguration / 驱动 DEVMODE） */
async function getPrinterOptions(name) {
  const safeName = psQuote(name);
  const script = `
    $cfg = Get-CimInstance -ClassName Win32_PrinterConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq ${safeName} } | Select-Object -First 1
    if (-not $cfg) { Write-Output '[]'; exit }
    $opts = @()
    $opts += [ordered]@{ key = 'PaperSize'; displayName = '纸张大小'; values = @(@{ value = [string]$cfg.PaperSize; isDefault = $true }) }
    $opts += [ordered]@{ key = 'Duplex'; displayName = '双面打印'; values = @(
      @{ value = 'OneSided'; isDefault = ([int]$cfg.Duplex -eq 1) },
      @{ value = 'TwoSidedLongEdge'; isDefault = ([int]$cfg.Duplex -eq 2) },
      @{ value = 'TwoSidedShortEdge'; isDefault = ([int]$cfg.Duplex -eq 3) }
    ) }
    $opts += [ordered]@{ key = 'Color'; displayName = '颜色'; values = @(
      @{ value = 'Color'; isDefault = [bool]$cfg.Color },
      @{ value = 'Monochrome'; isDefault = (-not [bool]$cfg.Color) }
    ) }
    $opts | ConvertTo-Json -Compress -Depth 5
  `;
  const data = await psJson(script);
  return asArray(data);
}

module.exports = {
  listPrinters,
  getPrinter,
  listPrinterNames,
  getDefaultPrinterName,
  isSchedulerRunning,
  submitJob,
  cancelJob,
  getJobStatus,
  listCupsJobs,
  getPrinterOptions,
  JOB_STATE_MAP,
  PRINTER_STATE_MAP,
};
