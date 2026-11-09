export function cachedFlag(store, name) {
  if (!store.cache.has(name)) store.cache.set(name, store.flags.find((f) => f.name === name) ?? null);
  return store.cache.get(name);
}
