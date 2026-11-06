import { avatarUrl } from './avatars.mjs';
import { displayName } from './names.mjs';

const view = (viewer, u) => ({ id: u.id, name: displayName(viewer, u), email: u.email, plan: u.plan, avatar: avatarUrl(viewer, u) });

export function getUser(store, viewer, id) {
  const user = store.users.find((u) => u.id === id);
  return user ? view(viewer, user) : null;
}

export function listUsers(store, viewer, { sort = 'id' } = {}) {
  return [...store.users].sort((a, b) => String(a[sort]).localeCompare(String(b[sort]))).map((u) => view(viewer, u));
}

export function searchUsers(store, viewer, query) {
  const q = query.toLowerCase();
  return store.users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q)).map((u) => view(viewer, u));
}
