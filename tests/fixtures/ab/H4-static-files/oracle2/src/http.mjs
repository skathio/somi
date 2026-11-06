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
  res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function fromError(res, err) {
  if (res.headersSent) return res.destroy();
  const known = err instanceof HttpError;
  sendJson(res, known ? err.status : 500, { error: { code: known ? err.code : 'internal_error', message: known ? err.message : 'unexpected error' } }, known ? err.headers : {});
}
