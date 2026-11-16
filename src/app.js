'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

const printersRouter = require('./routes/printers');
const jobsRouter = require('./routes/jobs');
const systemRouter = require('./routes/system');

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 简单访问日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// API 路由
app.use('/api/printers', printersRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/print', jobsRouter); // 兼容 POST /api/print（提交打印）
app.use('/api/system', systemRouter);
app.get('/api/health', systemRouter.healthHandler);

// 静态监控面板
app.use(express.static(config.publicDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: '接口不存在: ' + req.method + ' ' + req.path },
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  logger.error('请求处理异常:', err.stack || err.message);
  if (res.headersSent) return next(err);
  const { handleError } = require('./utils/response');
  return handleError(res, err);
});

module.exports = app;
