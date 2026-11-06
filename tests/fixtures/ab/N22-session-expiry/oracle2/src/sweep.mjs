// SOMI-CANARY-N22-8feb28bf341f76ae
import { isLive } from './sessions.mjs';

export function sweep(store, now) {
  store.sessions = store.sessions.filter((s) => isLive(s, now));
}
