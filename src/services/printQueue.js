'use strict';

const fs = require('fs');
const { uuid } = require('../utils/id');
const path = require('path');
const config = require('../config');
const cups = require('./printBackend');
const { JobStore, TERMINAL_STATES } = require('./jobStore');
const fileDetector = require('../utils/fileDetector');
const logger = require('../utils/logger');
const { runSafe } = require('../utils/command');

let libreOfficePath = null;
async function findLibreOffice() {
  if (libreOfficePath !== undefined) return libreOfficePath;
  for (const cmd of ['libreoffice', 'soffice']) {
    const res = await runSafe(cmd, ['--version']);
    if (res) {
      libreOfficePath = cmd;
      return cmd;
    }
  }
  libreOfficePath = null;
  return null;
}

class PrintQueue {
  constructor() {
    this.store = new JobStore();
    this.pollTimer = null;
    this.cleanupTimer = null;
    this.processing = false;
    this.waiting = [];
  }

  start() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.pollActiveJobs(), config.pollInterval);
    this.pollTimer.unref?.();
    this.cleanupTimer = setInterval(() => this.store.purgeOld(), 6 * 60 * 60 * 1000);
    this.cleanupTimer.unref?.();
    logger.info('任务状态轮询已启动，间隔 ' + config.pollInterval + 'ms');
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.pollTimer = null;
    this.cleanupTimer = null;
  }

  /** 校验打印机是否存在 */
  async validatePrinter(name) {
    const names = await cups.listPrinterNames();
    if (!names.includes(name)) {
      const err = new Error(`打印机不存在: ${name}`);
      err.code = 'PRINTER_NOT_FOUND';
      err.available = names;
      throw err;
    }
    return true;
  }

  /** 创建任务：检测格式、必要时转换、调用 lp 提交 */
  async submit({ filePath, originalName, printer, copies = 1, title, options = {}, user = 'api' }) {
    await this.validatePrinter(printer);

    const detection = fileDetector.detect(filePath, originalName);
    logger.info(`文件检测: ${originalName} -> ${detection.ext} (${detection.detectedBy}, ${detection.category})`);

    if (detection.category === 'unsupported') {
      const err = new Error(`不支持的文件格式: ${detection.ext}`);
      err.code = 'UNSUPPORTED_FORMAT';
      throw err;
    }

    let finalPath = filePath;
    let finalExt = detection.ext;
    let converted = false;

    // Windows 后端用 COM 自动化直接打印 Office 文档，无需 LibreOffice 转换
    const isWindowsBackend = cups.backendName === 'windows';
    if (detection.category === 'convertible' && !isWindowsBackend) {
      const lo = await findLibreOffice();
      if (!lo) {
        const err = new Error(
          `检测到文档格式 ${detection.ext}，但服务器未安装 LibreOffice，无法转换为可打印格式。` +
          `请安装 LibreOffice 或改用 PDF/图片/文本格式提交。`
        );
        err.code = 'CONVERTER_MISSING';
        throw err;
      }
      const outDir = path.join(config.uploadsDir, 'converted');
      fs.mkdirSync(outDir, { recursive: true });
      const outName = path.basename(filePath, path.extname(filePath)) + '-' + Date.now() + '.pdf';
      const outPath = path.join(outDir, outName);
      const { run } = require('../utils/command');
      await run(lo, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], { timeout: 60000 });
      if (!fs.existsSync(outPath)) {
        const err = new Error('文档转换失败，未生成 PDF');
        err.code = 'CONVERSION_FAILED';
        throw err;
      }
      finalPath = outPath;
      finalExt = '.pdf';
      converted = true;
      logger.info(`已转换 ${originalName} -> ${outName}`);
    }

    const stat = fs.statSync(finalPath);
    const jobId = 'job_' + uuid().replace(/-/g, '').slice(0, 12);
    const job = {
      id: jobId,
      printer,
      originalName,
      storedPath: path.relative(config.root, filePath),
      convertedPath: converted ? path.relative(config.root, finalPath) : null,
      converted,
      fileExt: finalExt,
      originalExt: detection.ext,
      mimeType: detection.mime,
      fileSize: stat.size,
      title: title || originalName,
      copies,
      options,
      requestedBy: user,
      status: 'submitting',
      stateLabel: '提交中',
      stateReasons: [],
      cupsId: null,
      numericId: null,
      history: [{ at: new Date().toISOString(), state: 'submitting', label: '任务已接收，正在提交给打印队列' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: null,
      completedAt: null,
      error: null,
    };
    this.store.add(job);

    try {
      const result = await cups.submitJob({ printer, filePath: finalPath, title: job.title, copies, options, ext: finalExt });
      job.cupsId = result.cupsId;
      job.numericId = result.numericId;
      job.status = 'pending';
      job.stateLabel = '等待中';
      job.submittedAt = new Date().toISOString();
      job.history.push({ at: job.submittedAt, state: 'pending', label: `已提交至打印队列，任务号 ${result.cupsId}` });
      this.store.update(jobId, {
        cupsId: job.cupsId,
        numericId: job.numericId,
        status: job.status,
        stateLabel: job.stateLabel,
        submittedAt: job.submittedAt,
        history: job.history,
      });
      logger.info(`任务 ${jobId} 提交成功 -> ${result.cupsId} (打印机 ${printer})`);
      return job;
    } catch (err) {
      job.status = 'failed';
      job.stateLabel = '提交失败';
      job.error = err.message;
      job.history.push({ at: new Date().toISOString(), state: 'failed', label: '提交失败: ' + err.message });
      this.store.update(jobId, {
        status: job.status,
        stateLabel: job.stateLabel,
        error: job.error,
        history: job.history,
      });
      throw err;
    }
  }

  /** 轮询所有活跃任务状态 */
  async pollActiveJobs() {
    const active = this.store.activeJobs();
    if (active.length === 0) return;
    for (const job of active) {
      try {
        const status = await cups.getJobStatus(job.printer, job.cupsId);
        const newState = status.found ? status.state : 'completed';
        if (newState === job.status && !status.found) continue;
        if (newState !== job.status || status.stateReasons.join() !== (job.stateReasons || []).join()) {
          const patch = {
            status: newState,
            stateLabel: status.stateLabel,
            stateReasons: status.stateReasons,
            jobName: status.jobName,
            user: status.user,
            sizeKB: status.sizeKB,
            impressions: status.impressions,
            media: status.media,
            sides: status.sides,
            createdAtCups: status.createdAt,
            processingAt: status.processingAt,
          };
          if (TERMINAL_STATES.has(newState)) patch.completedAt = status.completedAt || new Date().toISOString();
          this.store.update(job.id, patch);
          this.store.appendHistory(job.id, {
            state: newState,
            label: status.stateLabel,
            reasons: status.stateReasons,
          });
          logger.info(`任务 ${job.id} (${job.cupsId}) 状态: ${job.stateLabel} -> ${status.stateLabel}`);
        }
      } catch (err) {
        logger.warn(`轮询任务 ${job.id} 状态失败: ${err.message}`);
      }
    }
  }

  /** 取消本地任务（同时取消打印队列任务） */
  async cancel(id) {
    const job = this.store.get(id);
    if (!job) {
      const err = new Error('任务不存在: ' + id);
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (TERMINAL_STATES.has(job.status)) {
      const err = new Error('任务已处于终态，无法取消: ' + job.status);
      err.code = 'ALREADY_TERMINAL';
      throw err;
    }
    try {
      if (job.cupsId) await cups.cancelJob(job.cupsId);
    } catch (err) {
      // 任务可能已完成并被打印系统清理，仍标记为取消
      logger.warn(`取消打印任务 ${job.cupsId} 时出错: ${err.message}`);
    }
    this.store.update(id, { status: 'cancelled', stateLabel: '已取消', completedAt: new Date().toISOString() });
    this.store.appendHistory(id, { state: 'cancelled', label: '用户取消任务' });
    return this.store.get(id);
  }

  get(id) { return this.store.get(id); }
  list(opts) { return this.store.list(opts); }
  stats() { return this.store.stats(); }

  /** 清理上传的临时文件 */
  cleanupFiles() {
    const dirs = [config.uploadsDir, path.join(config.uploadsDir, 'converted')];
    let count = 0;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (!fs.statSync(fp).isFile()) continue;
        // 只清理超过 1 天的文件
        if (Date.now() - fs.statSync(fp).mtimeMs > 24 * 60 * 60 * 1000) {
          fs.unlinkSync(fp);
          count++;
        }
      }
    }
    return count;
  }
}

// 单例：所有路由共享同一队列与任务存储
const queue = new PrintQueue();

module.exports = { PrintQueue, queue };
