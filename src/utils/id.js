'use strict';

const crypto = require('crypto');

/**
 * 生成 UUID v4 风格字符串。
 * 不依赖 crypto.randomUUID（需 Node 14.17+），改用 randomBytes 实现，
 * 兼容 Node 10/12/14 等老版本，避免 "randomUUID is not a function"。
 */
function uuid() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // 版本 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC4122 变体
  const hex = b.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

module.exports = { uuid };
