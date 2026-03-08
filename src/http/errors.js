export function sendError(res, status, code, message) {
  return res.status(status).json({ error: code, message });
}

export function handleRouteError(res, err) {
  return sendError(
    res,
    err?.status || 500,
    err?.code || 'UNKNOWN_ERROR',
    err?.message || 'Unknown error'
  );
}
