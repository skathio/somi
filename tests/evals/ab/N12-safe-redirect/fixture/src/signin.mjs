import { config } from './config.mjs';

export function afterSignIn(req) {
  return { status: 302, headers: { location: config.home } };
}
