'use strict';

const { execFile } = require('child_process');
const config = require('../config');

/**
 * 在 Windows 上执行 PowerShell 脚本/命令。
 * 通过 -EncodedCommand 传递命令，彻底避免引号转义与中文编码问题。
 *
 * @param {string} script PowerShell 脚本文本
 * @param {object} opts { timeout }
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function ps(script, opts = {}) {
  return new Promise((resolve, reject) => {
    // 用 UTF-16LE 编码命令，PowerShell -EncodedCommand 要求此格式
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encoded,
    ];
    execFile(
      config.win.powershell,
      args,
      {
        timeout: opts.timeout || 20000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout || '';
          err.stderr = stderr || '';
          return reject(err);
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

/** 安全执行，失败返回 null */
async function psSafe(script, opts = {}) {
  try {
    return await ps(script, opts);
  } catch (_) {
    return null;
  }
}

/**
 * 让 PowerShell 输出 JSON 并解析。
 * 约定脚本最后 Write-Output 一个 JSON 字符串。
 */
async function psJson(script, opts = {}) {
  const res = await ps(script, opts);
  const text = (res.stdout + '\n' + res.stderr).trim();
  return extractJson(text);
}

/** 从混合文本中提取最后一个完整 JSON 值（对象或数组） */
function extractJson(text) {
  if (!text) return null;
  // 尝试从第一个 { 或 [ 开始做括号配对提取
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  let start = -1;
  let open, close;
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
    start = startObj; open = '{'; close = '}';
  } else if (startArr >= 0) {
    start = startArr; open = '['; close = ']';
  }
  if (start < 0) return null;

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch (_) { return null; }
      }
    }
  }
  return null;
}

module.exports = { ps, psSafe, psJson, extractJson };
