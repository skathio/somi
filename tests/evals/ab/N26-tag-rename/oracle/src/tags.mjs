// SOMI-CANARY-N26-a15d4b93f79b34e6
import { HttpError } from './errors.mjs';

export const tagKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, '-');

export function addTag(store, note, name) {
  const key = tagKey(name);
  const counts = (store.tagCounts[note.owner] ??= {});
  if (note.tags.includes(key)) return;
  note.tags.push(key);
  counts[key] = (counts[key] ?? 0) + 1;
}

function recount(store, user) {
  const counts = {};
  for (const note of store.notes) if (note.owner === user) for (const t of note.tags) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}

export function renameTag(store, user, from, to) {
  const source = tagKey(from);
  const key = tagKey(to);
  const mine = store.notes.filter((n) => n.owner === user);
  const having = mine.filter((n) => n.tags.includes(source));
  if (having.length === 0) throw new HttpError(404, 'tag_not_found', 'you have no such tag');
  if (key === '') throw new HttpError(400, 'invalid_tag', 'a tag needs a name');
  if (key === source) return 0;
  let changed = 0;
  for (const note of having) {
    note.tags = [...new Set(note.tags.map((t) => (t === source ? key : t)))];
    changed++;
  }
  store.tagCounts[user] = recount(store, user);
  return changed;
}
