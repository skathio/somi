// SOMI-CANARY-N22-8feb28bf341f76ae
export function sweep(store, now) {
  store.sessions = store.sessions.filter((s) => s.expiresAt > now);
}
