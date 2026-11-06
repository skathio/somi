// SOMI-CANARY-N22-8feb28bf341f76ae
import { config } from './config.mjs';

const MIN = 60000;

export function createSession(store, id, userId, now) {
  const session = { id, userId, createdAt: now, expiresAt: now + config.sessionMinutes * MIN };
  store.sessions.push(session);
  return session;
}

export function touch(session, now) {
  const hardStop = session.createdAt + config.absoluteHours * 60 * MIN;
  const idleStop = now + config.sessionMinutes * MIN;
  session.expiresAt = idleStop < hardStop ? idleStop : hardStop;
  return session;
}

const isLive = (s, now) => now < s.expiresAt;
export { isLive };

export function authenticate(store, id, now) {
  const s = store.sessions.find((x) => x.id === id);
  return s && isLive(s, now) ? touch(s, now) : null;
}
