// SOMI-CANARY-N26-a15d4b93f79b34e6
import { HttpError } from './errors.mjs';

export const tagKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, '-');

export function addTag(store, note, name) {
  const key = tagKey(name);
  if (note.tags.indexOf(key) !== -1) return;
  note.tags.push(key);
  const counts = store.tagCounts[note.owner] ?? (store.tagCounts[note.owner] = {});
  counts[key] = (counts[key] ?? 0) + 1;
}

export function renameTag(store, user, from, to) {
  const oldKey = tagKey(from);
  const newKey = tagKey(to);
  const notes = store.notes.filter((n) => n.owner === user && n.tags.includes(oldKey));
  if (!notes.length) throw new HttpError(404, 'tag_not_found', 'none');
  if (!newKey) throw new HttpError(400, 'invalid_tag', 'empty');
  if (oldKey === newKey) return 0;
  const counts = store.tagCounts[user];
  for (const note of notes) {
    const at = note.tags.indexOf(oldKey);
    if (note.tags.includes(newKey)) note.tags.splice(at, 1);
    else { note.tags[at] = newKey; counts[newKey] = (counts[newKey] ?? 0) + 1; }
    counts[oldKey] -= 1;
  }
  if (counts[oldKey] === 0) delete counts[oldKey];
  return notes.length;
}
