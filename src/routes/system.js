'use strict';

const express = require('express');
const os = require('os');
const cups = require('../services/printBackend');
const { queue } = require('../services/printQueue');
const config = require('../config');
const { ok } = require('../utils/response');

const router = express.Router();
const startedAt = Date.now();

/** 健康检查处理器（供多个路由复用） */
async function healthHandler(req, res) {
  const schedulerRunning = await cups.isSchedulerRunning();
  const healthy = schedulerRunning;
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    schedulerRunning,
    version: '1.0.0',
  });
}
router.get('/health', healthHandler);

/** GET /api/system/info - 系统与能力信息 */
router.get('/info', async (req, res) => {
  const printers = await cups.listPrinters();
  const defaultName = await cups.getDefaultPrinterName();
  return ok(res, {
    service: 'print-server-windows',
    version: '1.0.0',
    backend: require('../services/printBackend').backendName,
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    hostname: os.hostname(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    defaultPrinter: defaultName,
    printerCount: printers.length,
    supportedFormats: Object.entries(config.allowedFormats).map(([ext, v]) => ({
      ext, label: v.label, mime: v.mime,
    })),
    convertibleFormats: Object.keys(config.convertibleFormats),
    maxFileSizeMB: Math.round(config.maxFileSize / 1024 / 1024),
    jobStats: queue.stats(),
  });
});

module.exports = router;
module.exports.healthHandler = healthHandler;
