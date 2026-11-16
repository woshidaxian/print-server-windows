'use strict';

/** 统一成功响应 */
function ok(res, data, message) {
  return res.status(200).json({
    success: true,
    ...(message ? { message } : {}),
    data,
  });
}

/** 统一创建响应 */
function created(res, data, message) {
  return res.status(201).json({
    success: true,
    ...(message ? { message } : {}),
    data,
  });
}

/** 统一错误响应 */
function fail(res, status, message, code, extra) {
  return res.status(status).json({
    success: false,
    error: {
      code: code || 'ERROR',
      message,
      ...(extra || {}),
    },
  });
}

/** 把服务层抛出的错误映射为 HTTP 响应 */
function handleError(res, err, defaultStatus = 500) {
  // err.code 可能是数字（如 execFile 错误的 errno），只接受字符串错误码
  const code = typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR';
  const statusMap = {
    PRINTER_NOT_FOUND: 404,
    UNSUPPORTED_FORMAT: 415,
    CONVERTER_MISSING: 422,
    CONVERSION_FAILED: 500,
    PRINT_SUBMIT_FAILED: 422,
    NOT_FOUND: 404,
    ALREADY_TERMINAL: 409,
    LIMIT_FILE_SIZE: 413,
    VALIDATION_ERROR: 400,
  };
  const status = statusMap[code] || defaultStatus;
  const extra = {};
  if (err.available) extra.availablePrinters = err.available;
  return fail(res, status, err.message || '服务器内部错误', code, extra);
}

module.exports = { ok, created, fail, handleError };
