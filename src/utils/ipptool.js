'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const { runSafe } = require('./command');
const logger = require('./logger');

let counter = 0;

const ATTR_METHODS = [
  { name: 'printer-state', type: 'state' },
  { name: 'printer-state-reasons', type: 'list' },
  { name: 'printer-state-message', type: 'text' },
  { name: 'printer-info', type: 'text' },
  { name: 'printer-make-and-model', type: 'text' },
  { name: 'printer-location', type: 'text' },
  { name: 'printer-is-accepting-jobs', type: 'boolean' },
  { name: 'printer-up-time', type: 'number' },
  { name: 'queued-job-count', type: 'number' },
  { name: 'media-default', type: 'text' },
  { name: 'document-format-supported', type: 'list' },
  { name: 'device-uri', type: 'text' },
];

const JOB_METHODS = [
  { name: 'job-id', type: 'number' },
  { name: 'job-state', type: 'state' },
  { name: 'job-state-reasons', type: 'list' },
  { name: 'job-name', type: 'text' },
  { name: 'job-originating-user-name', type: 'text' },
  { name: 'job-k-octets', type: 'number' },
  { name: 'job-impressions', type: 'number' },
  { name: 'time-at-creation', type: 'number' },
  { name: 'time-at-processing', type: 'number' },
  { name: 'time-at-completed', type: 'number' },
  { name: 'media', type: 'text' },
  { name: 'copies', type: 'number' },
  { name: 'sides', type: 'text' },
];

function buildTestFile(operation, attrLines) {
  const lines = [
    '{',
    `  OPERATION ${operation}`,
    '  GROUP operation-attributes-tag',
    '  ATTR charset attributes-charset utf-8',
    '  ATTR naturalLanguage attributes-natural-language en',
    '  ATTR uri printer-uri $uri',
    ...attrLines,
    '  STATUS successful-ok',
    '}',
    '',
  ];
  return lines.join('\n');
}

function writeTempTest(content) {
  const file = path.join(os.tmpdir(), `print-server-ipp-${process.pid}-${++counter}-${Date.now()}.test`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function parseIppOutput(output) {
  const result = { ok: false, statusCode: null, attributes: {} };
  if (!output) return result;

  const sm = output.match(/^\s*status-code\s*=\s*([^\s(]+)/m);
  if (sm) result.statusCode = sm[1];
  result.ok = result.statusCode === 'successful-ok';

  // 只解析 RECEIVED 之后（响应部分），避免把请求回显当成属性
  const marker = output.indexOf('RECEIVED:');
  const body = marker >= 0 ? output.slice(marker) : output;
  const re = /^\s+([\w-]+)\s+\([^)]+\)\s*=\s*(.*)$/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1];
    let value = m[2].trim();
    if (value === 'no-value' || value === 'unknown') value = null;
    if (!(key in result.attributes)) result.attributes[key] = value; // 第一个即主值
  }
  return result;
}

function normalize(attrs, methods) {
  const out = {};
  for (const method of methods) {
    if (!(method.name in attrs)) continue;
    const raw = attrs[method.name];
    switch (method.type) {
      case 'list': out[method.name] = raw == null ? [] : String(raw).split(',').map((s) => s.trim()).filter(Boolean); break;
      case 'number': out[method.name] = raw == null ? null : Number(raw); break;
      case 'boolean': out[method.name] = raw === 'true'; break;
      case 'text': out[method.name] = raw == null ? '' : String(raw); break;
      default: out[method.name] = raw;
    }
  }
  return out;
}

async function execute(operation, printerName, attrLines) {
  const testFile = writeTempTest(buildTestFile(operation, attrLines));
  const uri = `${config.cups.ippBaseUri}/${encodeURIComponent(printerName)}`;
  try {
    const res = await runSafe(config.cups.ipptool, ['-tv', uri, testFile], { timeout: 10000 });
    if (!res) {
      logger.warn(`ipptool 执行失败: ${operation} ${printerName}`);
      return { ok: false, statusCode: null, attributes: {} };
    }
    return parseIppOutput(res.stdout + res.stderr);
  } finally {
    try { fs.unlinkSync(testFile); } catch (_) { /* ignore */ }
  }
}

/** 查询打印机属性 */
async function getPrinterAttributes(printerName) {
  const result = await execute('Get-Printer-Attributes', printerName, []);
  return {
    ...result,
    attributes: normalize(result.attributes, ATTR_METHODS),
  };
}

/** 查询单个打印任务属性 */
async function getJobAttributes(printerName, jobId) {
  // jobId 来自内部解析的 CUPS 任务号，这里再校验一次确保是正整数
  const safeId = Number.parseInt(jobId, 10);
  if (!Number.isInteger(safeId) || safeId <= 0) {
    return { ok: false, statusCode: 'invalid-job-id', attributes: {} };
  }
  const result = await execute('Get-Job-Attributes', printerName, [`  ATTR integer job-id ${safeId}`]);
  return {
    ...result,
    attributes: normalize(result.attributes, JOB_METHODS),
  };
}

module.exports = { getPrinterAttributes, getJobAttributes, parseIppOutput };
