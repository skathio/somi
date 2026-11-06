export function sweep(store, now) {
  store.sessions = store.sessions.filter((s) => s.expiresAt > now / 1000);
}
