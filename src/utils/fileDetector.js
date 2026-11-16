'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

/** 常见二进制签名 */
const SIGNATURES = [
  { name: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { name: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'gif87', bytes: Buffer.from('GIF87a') },
  { name: 'gif89', bytes: Buffer.from('GIF89a') },
  { name: 'tiff-le', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { name: 'tiff-be', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { name: 'bmp', bytes: [0x42, 0x4d] },
  { name: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'ps', bytes: Buffer.from('%!PS') },
  { name: 'ps-epsf', bytes: Buffer.from('%!PS-Adobe') },
];

function matches(buf, signature) {
  const bytes = Buffer.isBuffer(signature.bytes) ? signature.bytes : Buffer.from(signature.bytes);
  if (buf.length < bytes.length) return false;
  return buf.subarray(0, bytes.length).equals(bytes);
}

/** 从 ZIP(OOXML/ODF) 内容里推断文档子类型 */
function detectZipSubtype(buf) {
  const s = buf.toString('latin1');
  if (s.includes('word/document.xml')) return { ext: '.docx', name: 'Word 文档 (.docx)' };
  if (s.includes('xl/workbook.xml')) return { ext: '.xlsx', name: 'Excel 文档 (.xlsx)' };
  if (s.includes('ppt/presentation.xml')) return { ext: '.pptx', name: 'PowerPoint 文档 (.pptx)' };
  if (s.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return { ext: '.odt', name: 'OpenDocument 文本' };
  if (s.includes('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) return { ext: '.ods', name: 'OpenDocument 表格' };
  if (s.includes('mimetypeapplication/vnd.oasis.opendocument.presentation')) return { ext: '.odp', name: 'OpenDocument 演示' };
  return { ext: '.zip', name: 'ZIP 压缩包' };
}

/**
 * 检测文件类型
 * @param {string} filePath
 * @param {string} originalName 原始文件名（用于扩展名兜底）
 * @returns {{ext, mime, label, cupsFormat, category: 'printable'|'convertible'|'unsupported', detectedBy, subtypeName?}}
 */
function detect(filePath, originalName) {
  let head;
  try {
    const fd = fs.openSync(filePath, 'r');
    head = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    head = head.subarray(0, read);
    fs.closeSync(fd);
  } catch (_) {
    head = Buffer.alloc(0);
  }

  let ext = null;
  let detectedBy = 'signature';

  for (const sig of SIGNATURES) {
    if (!matches(head, sig)) continue;
    switch (sig.name) {
      case 'pdf': ext = '.pdf'; break;
      case 'png': ext = '.png'; break;
      case 'jpeg': ext = '.jpg'; break;
      case 'gif87':
      case 'gif89': ext = '.gif'; break;
      case 'tiff-le':
      case 'tiff-be': ext = '.tiff'; break;
      case 'bmp': ext = '.bmp'; break;
      case 'ps':
      case 'ps-epsf': ext = '.ps'; break;
      case 'zip': {
        const sub = detectZipSubtype(head);
        ext = sub.ext;
        break;
      }
      default: break;
    }
    break;
  }

  // 签名没识别出来 -> 用扩展名
  if (!ext) {
    detectedBy = 'extension';
    ext = path.extname(originalName || '').toLowerCase();
  }

  // 文本兜底：可打印文本且无二进制控制字符
  if (!ext || !config.allowedFormats[ext]) {
    const looksText = head.length > 0 && !head.includes(0) &&
      head.subarray(0, Math.min(head.length, 512)).toString('utf8').replace(/[\t\n\r]/g, '').indexOf('\uFFFD') === -1;
    if (looksText && (!ext || ['.txt', '.log', '.csv', ''].includes(ext))) {
      ext = '.txt';
      detectedBy = 'text-heuristic';
    }
  }

  const fmt = config.allowedFormats[ext];
  if (fmt) {
    return {
      ext,
      mime: fmt.mime,
      label: fmt.label,
      cupsFormat: fmt.cupsFormat,
      category: 'printable',
      detectedBy,
    };
  }

  if (config.convertibleFormats[ext]) {
    return {
      ext,
      mime: config.convertibleFormats[ext],
      label: ext.replace('.', '').toUpperCase() + ' 文档（需转换）',
      cupsFormat: null,
      category: 'convertible',
      detectedBy,
    };
  }

  return {
    ext: ext || '.bin',
    mime: 'application/octet-stream',
    label: '不支持的格式',
    cupsFormat: null,
    category: 'unsupported',
    detectedBy,
  };
}

module.exports = { detect };
