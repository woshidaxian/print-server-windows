'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', '..', 'logs', 'server.log');

function ensureLogDir() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  } catch (_) {
    /* ignore */
  }
}

function write(level, ...args) {
  const time = new Date().toISOString();
  const msg = args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  const line = `[${time}] [${level}] ${msg}`;
  const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleFn(line);
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (_) {
    /* ignore */
  }
}

module.exports = {
  info: (...a) => write('INFO', ...a),
  warn: (...a) => write('WARN', ...a),
  error: (...a) => write('ERROR', ...a),
  debug: (...a) => {
    if (process.env.DEBUG) write('DEBUG', ...a);
  },
};
