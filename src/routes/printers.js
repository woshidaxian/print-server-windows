'use strict';

const express = require('express');
const cups = require('../services/printBackend');
const { ok, handleError } = require('../utils/response');

const router = express.Router();

/** GET /api/printers - 打印机列表 */
router.get('/', async (req, res) => {
  try {
    const printers = await cups.listPrinters();
    return ok(res, { total: printers.length, printers });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/printers/default - 默认打印机 */
router.get('/default', async (req, res) => {
  try {
    const name = await cups.getDefaultPrinterName();
    const printer = name ? await cups.getPrinter(name) : null;
    return ok(res, { name, printer });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/printers/:name - 单台打印机详情 */
router.get('/:name', async (req, res) => {
  try {
    const printer = await cups.getPrinter(req.params.name);
    if (!printer.reachable) {
      const err = new Error(`打印机不存在或无法访问: ${req.params.name}`);
      err.code = 'PRINTER_NOT_FOUND';
      return handleError(res, err);
    }
    return ok(res, printer);
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/printers/:name/options - 打印机可用选项 */
router.get('/:name/options', async (req, res) => {
  try {
    const options = await cups.getPrinterOptions(req.params.name);
    return ok(res, { printer: req.params.name, options });
  } catch (err) {
    return handleError(res, err);
  }
});

/** GET /api/printers/:name/jobs - 打印机当前 CUPS 任务队列 */
router.get('/:name/jobs', async (req, res) => {
  try {
    const which = ['all', 'not-completed', 'completed'].includes(req.query.which) ? req.query.which : 'all';
    const jobs = await cups.listCupsJobs(req.params.name, which);
    return ok(res, { printer: req.params.name, which, total: jobs.length, jobs });
  } catch (err) {
    return handleError(res, err);
  }
});

module.exports = router;
