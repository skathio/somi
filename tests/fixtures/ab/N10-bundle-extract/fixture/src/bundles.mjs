import { HttpError } from './errors.mjs';

export function listBundle(bundle) {
  if (!Array.isArray(bundle)) throw new HttpError(400, 'invalid_bundle', 'a bundle is a list');
  return bundle.map((e) => e.path);
}
