'use strict';

/**
 * 平台抽象层：根据操作系统或环境变量选择打印后端。
 * 两个后端对外暴露完全相同的接口，上层代码无需感知差异。
 *
 * 可通过环境变量 PRINT_BACKEND 强制指定：
 *   PRINT_BACKEND=win  使用 Windows 打印后端
 *   PRINT_BACKEND=cups 使用 CUPS 后端
 */

const forced = (process.env.PRINT_BACKEND || '').toLowerCase();
let backend;

if (forced === 'win' || forced === 'windows') {
  backend = require('./winprintService');
} else if (forced === 'cups') {
  backend = require('./cupsService');
} else if (process.platform === 'win32') {
  backend = require('./winprintService');
} else {
  backend = require('./cupsService');
}

module.exports = backend;
module.exports.backendName = forced
  ? (forced.startsWith('win') ? 'windows' : 'cups')
  : (process.platform === 'win32' ? 'windows' : 'cups');
