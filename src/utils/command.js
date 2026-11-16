'use strict';

const { execFile } = require('child_process');

/**
 * 安全地执行命令（不使用 shell，避免注入与中文编码问题）
 * @param {string} cmd 命令
 * @param {string[]} args 参数
 * @param {object} opts { timeout, env }
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout || 15000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, LANG: 'C', LC_ALL: 'C', ...(opts.env || {}) },
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

/** 尝试执行，失败返回 null（不抛异常） */
async function runSafe(cmd, args = [], opts = {}) {
  try {
    return await run(cmd, args, opts);
  } catch (_) {
    return null;
  }
}

module.exports = { run, runSafe };
