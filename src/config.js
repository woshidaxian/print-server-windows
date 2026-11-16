'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  root: ROOT,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',

  // 目录
  uploadsDir: path.join(ROOT, 'uploads'),
  dataDir: path.join(ROOT, 'data'),
  logsDir: path.join(ROOT, 'logs'),
  publicDir: path.join(ROOT, 'public'),
  jobsFile: path.join(ROOT, 'data', 'jobs.json'),
  ipptoolWorkDir: path.join(ROOT, 'data', 'ipp-tests'),

  // 上传限制：50MB
  maxFileSize: Number(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024,

  // 任务状态轮询间隔（毫秒）
  pollInterval: Number(process.env.POLL_INTERVAL) || 3000,

  // 保留历史任务天数
  keepHistoryDays: Number(process.env.KEEP_HISTORY_DAYS) || 7,

  // CUPS 命令（仅 CUPS 后端使用，Windows 版保留以便跨平台）
  cups: {
    lp: process.env.LP_CMD || 'lp',
    lpstat: process.env.LPSTAT_CMD || 'lpstat',
    lpoptions: process.env.LPOPTIONS_CMD || 'lpoptions',
    cancel: process.env.CANCEL_CMD || 'cancel',
    ipptool: process.env.IPPTOOL_CMD || 'ipptool',
    ippBaseUri: process.env.IPP_BASE_URI || 'ipp://localhost/printers',
  },

  // Windows 打印配置
  win: {
    // PowerShell 可执行文件名（Windows 默认在 PATH 中）
    powershell: process.env.POWERSHELL_CMD || 'powershell.exe',
    // 外部打印工具：'auto' 表示用系统 Shell Print / COM；
    // 也可指定如 PDFtoPrinter.exe 的完整路径，PDF 将通过它打印
    printTool: process.env.WIN_PRINT_TOOL || 'auto',
    // 单次打印提交超时（毫秒），COM 启动 Office 可能较慢
    printTimeout: Number(process.env.WIN_PRINT_TIMEOUT) || 90000,
  },

  // 文件扩展名 -> 允许的 MIME / 打印文档格式
  // 常见可打印格式：PDF、图片、纯文本、PostScript 等
  allowedFormats: {
    '.pdf': { mime: 'application/pdf', label: 'PDF 文档', cupsFormat: 'application/pdf' },
    '.png': { mime: 'image/png', label: 'PNG 图片', cupsFormat: 'image/png' },
    '.jpg': { mime: 'image/jpeg', label: 'JPEG 图片', cupsFormat: 'image/jpeg' },
    '.jpeg': { mime: 'image/jpeg', label: 'JPEG 图片', cupsFormat: 'image/jpeg' },
    '.gif': { mime: 'image/gif', label: 'GIF 图片', cupsFormat: 'image/gif' },
    '.tif': { mime: 'image/tiff', label: 'TIFF 图片', cupsFormat: 'image/tiff' },
    '.tiff': { mime: 'image/tiff', label: 'TIFF 图片', cupsFormat: 'image/tiff' },
    '.bmp': { mime: 'image/bmp', label: 'BMP 图片', cupsFormat: 'image/x-ms-bmp' },
    '.webp': { mime: 'image/webp', label: 'WebP 图片', cupsFormat: 'image/webp' },
    '.txt': { mime: 'text/plain', label: '纯文本', cupsFormat: 'text/plain' },
    '.log': { mime: 'text/plain', label: '文本文件', cupsFormat: 'text/plain' },
    '.csv': { mime: 'text/plain', label: 'CSV 文本', cupsFormat: 'text/plain' },
    '.ps': { mime: 'application/postscript', label: 'PostScript', cupsFormat: 'application/postscript' },
    '.eps': { mime: 'application/postscript', label: 'EPS', cupsFormat: 'application/postscript' },
  },

  // 需要 LibreOffice 转换的格式
  convertibleFormats: {
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
    '.rtf': 'application/rtf',
  },
};
