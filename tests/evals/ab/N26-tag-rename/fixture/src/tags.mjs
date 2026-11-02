export const tagKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, '-');

export function addTag(store, note, name) {
  const key = tagKey(name);
  const counts = (store.tagCounts[note.owner] ??= {});
  note.tags.push(key);
  counts[key] = (counts[key] ?? 0) + 1;
}
