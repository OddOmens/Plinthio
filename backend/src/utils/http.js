// Unexpected failures (SQL errors, filesystem errors) carry internals in their message —
// table names, absolute paths, library layout. Those belong in the server log, not in a
// response any signed-in viewer can read. Admins still get the detail, since they're the
// ones who'd act on it and can already read the logs anyway.
export function serverError(req, res, err, message = 'Something went wrong on the server') {
  console.error(`[${req.method} ${req.baseUrl || ''}${req.route?.path || ''}]`, err);
  if (res.headersSent) return;
  const detail = req.user?.role === 'admin' && err?.message ? err.message : undefined;
  res.status(500).json(detail ? { error: message, detail } : { error: message });
}
