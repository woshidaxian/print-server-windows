'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const upload = require('./upload');
const { queue } = require('../services/printQueue');
const config = require('../config');
const { ok, created, fail, handleError } = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/print
 * 提交打印任务（multipart/form-data）
 *
 * 表单字段:
 *   file       必填，打印文件
 *   printer    可选，打印机名（默认 CUPS 默认打印机）
 *   copies     可选，份数（默认 1）
 *   title      可选，任务标题
 *   options    可选，JSON 字符串形式的打印选项
 *              例: {"media":"A4","duplex":true,"color":false,"numberUp":2}
 */
router.post('/', upload.single('file'), async (req, res) => {
  let filePath = req.file ? req.file.path : null;
  try {
    if (!req.file) {
      return fail(res, 400, '缺少文件字段 file', 'VALIDATION_ERROR');
    }

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    let printer = req.body.printer;
    if (!printer) {
      printer = await require('../services/printBackend').getDefaultPrinterName();
      if (!printer) {
        return fail(res, 400, '未指定打印机且系统没有默认打印机', 'VALIDATION_ERROR');
      }
    }

    const copies = req.body.copies ? Number.parseInt(req.body.copies, 10) : 1;
    if (!Number.isInteger(copies) || copies < 1 || copies > 999) {
      return fail(res, 400, 'copies 必须是 1-999 的整数', 'VALIDATION_ERROR');
    }

    let options = {};
    if (req.body.options) {
      try {
        options = typeof req.body.options === 'string' ? JSON.parse(req.body.options) : req.body.options;
      } catch (_) {
        return fail(res, 400, 'options 不是合法的 JSON 字符串', 'VALIDATION_ERROR');
      }
    }

    const job = await queue.submit({
      filePath,
      originalName,
      printer,
      copies,
      title: req.body.title,
      options,
      user: req.body.user || 'api',
    });
    return created(res, job, '打印任务已提交');
  } catch (err) {
    logger.error('提交打印失败:', err.message);
    // 提交阶段失败时清理临时文件
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }
    return handleError(res, err);
  }
});

/** GET /api/jobs - 任务列表 */
router.get('/', (req, res) => {
  const result = queue.list({
    status: req.query.status,
    printer: req.query.printer,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  return ok(res, result);
});

/** GET /api/jobs/stats - 任务统计 */
router.get('/stats', (req, res) => {
  return ok(res, queue.stats());
});

/** GET /api/jobs/:id - 任务详情（实时刷新 CUPS 状态） */
router.get('/:id', async (req, res) => {
  const job = queue.get(req.params.id);
  if (!job) return fail(res, 404, '任务不存在: ' + req.params.id, 'NOT_FOUND');

  // 主动拉取一次最新状态，保证详情实时性
  try {
    await queue.pollActiveJobs();
  } catch (_) { /* ignore */ }
  return ok(res, queue.get(req.params.id));
});

/** GET /api/jobs/:id/status - 仅状态 */
router.get('/:id/status', (req, res) => {
  const job = queue.get(req.params.id);
  if (!job) return fail(res, 404, '任务不存在: ' + req.params.id, 'NOT_FOUND');
  return ok(res, {
    id: job.id,
    status: job.status,
    stateLabel: job.stateLabel,
    stateReasons: job.stateReasons,
    cupsId: job.cupsId,
    printer: job.printer,
    updatedAt: job.updatedAt,
  });
});

/** DELETE /api/jobs/:id - 取消任务 */
router.delete('/:id', async (req, res) => {
  try {
    const job = await queue.cancel(req.params.id);
    return ok(res, job, '任务已取消');
  } catch (err) {
    return handleError(res, err);
  }
});

module.exports = router;
