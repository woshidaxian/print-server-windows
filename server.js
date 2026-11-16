'use strict';

const http = require('http');
const config = require('./src/config');
const app = require('./src/app');
const { queue } = require('./src/services/printQueue');
const logger = require('./src/utils/logger');

const server = http.createServer(app);

server.listen(config.port, config.host, () => {
  queue.start();
  logger.info(`打印服务器已启动: http://${config.host}:${config.port}`);
  console.log('\n  打印服务器已启动');
  console.log(`  API 地址:     http://localhost:${config.port}/api`);
  console.log(`  监控面板:     http://localhost:${config.port}`);
  console.log(`  健康检查:     http://localhost:${config.port}/api/health\n`);
});

function shutdown() {
  logger.info('接收到退出信号，正在关闭服务器...');
  queue.stop();
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => logger.error('未捕获异常:', err.stack || err));
process.on('unhandledRejection', (err) => logger.error('未处理的 Promise 拒绝:', err));

module.exports = server;
