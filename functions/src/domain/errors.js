'use strict';
class AppError extends Error {
  constructor(code, httpStatus, message) {
    super(message || code);
    this.code = code;
    this.httpStatus = httpStatus || 400;
  }
}
module.exports = { AppError };
