export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const notFound = () => new HttpError(404, 'not_found', 'not found');
