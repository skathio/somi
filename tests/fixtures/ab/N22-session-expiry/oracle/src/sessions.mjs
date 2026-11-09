// SOMI-CANARY-N22-8feb28bf341f76ae
import { config } from './config.mjs';

const IDLE = config.sessionMinutes * 60000;
const ABSOLUTE = config.absoluteHours * 3600000;

export function createSession(store, id, userId, now) {
  const session = { id, userId, createdAt: now, expiresAt: now + IDLE };
  store.sessions.push(session);
  return session;
}

export function touch(session, now) {
  session.expiresAt = Math.min(now + IDLE, session.createdAt + ABSOLUTE);
  return session;
}

export function authenticate(store, id, now) {
  const session = store.sessions.find((s) => s.id === id);
  if (!session || session.expiresAt <= now) return null;
  return touch(session, now);
}
