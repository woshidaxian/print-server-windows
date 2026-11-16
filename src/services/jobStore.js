'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/** 终态：不再轮询 */
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'aborted', 'failed']);

class JobStore {
  constructor() {
    this.jobs = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(config.jobsFile)) {
        const raw = fs.readFileSync(config.jobsFile, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          for (const job of data) this.jobs.set(job.id, job);
          logger.info(`已从 ${config.jobsFile} 加载 ${this.jobs.size} 条任务记录`);
        }
      }
    } catch (err) {
      logger.error('加载任务记录失败:', err.message);
    }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(config.jobsFile), { recursive: true });
      const tmp = config.jobsFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...this.jobs.values()], null, 2), 'utf8');
      fs.renameSync(tmp, config.jobsFile);
    } catch (err) {
      logger.error('持久化任务记录失败:', err.message);
    }
  }

  add(job) {
    this.jobs.set(job.id, job);
    this._persist();
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  update(id, patch) {
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this._persist();
    return job;
  }

  appendHistory(id, entry) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (!Array.isArray(job.history)) job.history = [];
    job.history.push({ at: new Date().toISOString(), ...entry });
    this._persist();
    return job;
  }

  list({ status, printer, limit, offset } = {}) {
    let list = [...this.jobs.values()];
    if (status) list = list.filter((j) => j.status === status);
    if (printer) list = list.filter((j) => j.printer === printer);
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = list.length;
    const off = Number(offset) || 0;
    if (offset !== undefined || limit !== undefined) {
      list = list.slice(off, off + (Number(limit) || 20));
    }
    return { total, jobs: list };
  }

  /** 活跃任务（需要轮询状态） */
  activeJobs() {
    return [...this.jobs.values()].filter((j) => j.cupsId && !TERMINAL_STATES.has(j.status));
  }

  /** 清理过期历史 */
  purgeOld(days = config.keepHistoryDays) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [id, job] of this.jobs) {
      if (!TERMINAL_STATES.has(job.status)) continue;
      const t = new Date(job.completedAt || job.updatedAt || job.createdAt).getTime();
      if (t < cutoff) {
        this.jobs.delete(id);
        removed++;
      }
    }
    if (removed) this._persist();
    return removed;
  }

  stats() {
    const byStatus = {};
    const byPrinter = {};
    for (const job of this.jobs.values()) {
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;
      byPrinter[job.printer] = (byPrinter[job.printer] || 0) + 1;
    }
    return {
      total: this.jobs.size,
      byStatus,
      byPrinter,
      active: this.activeJobs().length,
    };
  }
}

module.exports = { JobStore, TERMINAL_STATES };
