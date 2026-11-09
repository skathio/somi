// SOMI-CANARY-N39-21c2acaf1fd9a27c
import { avatarUrl } from './avatars.mjs';
import { displayName } from './names.mjs';

function view(viewer, u) {
  const out = { id: u.id, name: displayName(viewer, u), plan: u.plan, avatar: avatarUrl(viewer, u) };
  if (viewer.admin) out.email = u.email;
  return out;
}

export function getUser(store, viewer, id) {
  const user = store.users.find((u) => u.id === id);
  return user ? view(viewer, user) : null;
}

export function listUsers(store, viewer, { sort = 'id' } = {}) {
  const key = sort === 'email' && !viewer.admin ? 'id' : sort;
  return [...store.users].sort((a, b) => String(a[key]).localeCompare(String(b[key]))).map((u) => view(viewer, u));
}

export function searchUsers(store, viewer, query) {
  const q = query.toLowerCase();
  return store.users.filter((u) => {
    const hay = viewer.admin ? `${u.name} ${u.email}` : u.name;
    return hay.toLowerCase().includes(q);
  }).map((u) => view(viewer, u));
}
