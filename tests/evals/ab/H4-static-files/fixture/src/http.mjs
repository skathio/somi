// Response helpers shared by every route. Errors always use the shape { "error": { "code", "message" } }.
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

export function fromError(res, err) {
  if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message);
  return sendError(res, 500, 'internal_error', 'unexpected error');
}
