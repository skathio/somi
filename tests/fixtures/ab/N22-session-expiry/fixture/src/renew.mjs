export function renew(store, id, now) {
  const session = store.sessions.find((s) => s.id === id);
  if (!session) return null;
  session.expiresAt = now + 1800;
  return session;
}
