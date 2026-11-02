// SOMI-CANARY-N39-21c2acaf1fd9a27c
import { avatarUrl } from './avatars.mjs';
import { displayName } from './names.mjs';

function view(viewer, u) {
  const { email } = u;
  return { id: u.id, name: displayName(viewer, u), email: viewer.admin ? email : undefined, plan: u.plan, avatar: avatarUrl(viewer, u) };
}

export function getUser(store, viewer, id) {
  const user = store.users.find((u) => u.id === id);
  return user ? view(viewer, user) : null;
}

export function listUsers(store, viewer, { sort = 'id' } = {}) {
  if (sort === 'email' && !viewer.admin) throw new Error('not allowed');
  return [...store.users].sort((a, b) => String(a[sort]).localeCompare(String(b[sort]))).map((u) => view(viewer, u));
}

export function searchUsers(store, viewer, query) {
  const q = query.toLowerCase();
  const fields = (u) => (viewer.admin ? [u.name, u.email] : [u.name]);
  return store.users.filter((u) => fields(u).join(' ').toLowerCase().includes(q)).map((u) => view(viewer, u));
}
