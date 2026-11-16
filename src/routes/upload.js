'use strict';

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// 允许提交的扩展名（含需转换的 Office 文档）
const allowedExts = new Set([
  ...Object.keys(config.allowedFormats),
  ...Object.keys(config.convertibleFormats),
]);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    cb(null, config.uploadsDir);
  },
  filename(req, file, cb) {
    // 保留扩展名，避免中文/特殊字符文件名引发问题
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, safeName);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.has(ext)) return cb(null, true);
  const err = new Error(`不允许的文件类型: ${ext || '(无扩展名)'}`);
  err.code = 'UNSUPPORTED_FORMAT';
  cb(err);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSize,
    files: 1,
  },
});

module.exports = upload;
