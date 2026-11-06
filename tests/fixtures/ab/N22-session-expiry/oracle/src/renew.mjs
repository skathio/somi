// SOMI-CANARY-N22-8feb28bf341f76ae
import { touch } from './sessions.mjs';

export function renew(store, id, now) {
  const session = store.sessions.find((s) => s.id === id);
  if (!session || session.expiresAt <= now) return null;
  return touch(session, now);
}
