import { sendError, codeForFsError } from '../errors.js';

// Unexpected failures. Internals go to the server log (and to admins as `detail`, see
// sendError); filesystem errors map to a library code (e.g. P201 for a disconnected drive).
export function serverError(req, res, err, message) {
  const code = err?.plinthioCode || codeForFsError(err) || 'P000';
  sendError(req, res, code, { err, message: err?.plinthioCode ? err.message : message });
}

// Wraps an async route handler so anything it throws ends in serverError.
export const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    serverError(req, res, err);
  }
};
