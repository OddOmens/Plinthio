import { sendError, codeForFsError } from '../errors.js';

// Unexpected failures (SQL errors, filesystem errors). The response carries a Plinthio error
// code; the internals (table names, absolute paths) go to the server log, and to admins only
// as `detail` — see sendError in errors.js. Filesystem failures get the library code that
// explains them (e.g. P201 for an I/O error from a disconnected drive) instead of P000.
export function serverError(req, res, err, message) {
  const code = err?.plinthioCode || codeForFsError(err) || 'P000';
  sendError(req, res, code, { err, message: err?.plinthioCode ? err.message : message });
}
