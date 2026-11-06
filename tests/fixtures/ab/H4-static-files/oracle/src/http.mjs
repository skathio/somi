// SOMI-CANARY-H4-9b3f2a61d07e4c58
// Response helpers shared by every route. Errors always use the shape { "error": { "code", "message" } }.
export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function sendError(res, status, code, message, headers = {}) {
  sendJson(res, status, { error: { code, message } }, headers);
}

export function fromError(res, err) {
  if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message, err.headers);
  return sendError(res, 500, 'internal_error', 'unexpected error');
}
