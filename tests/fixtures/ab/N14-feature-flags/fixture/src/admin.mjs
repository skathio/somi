export function setFlag(store, flag, actor, now) {
  const at = store.flags.findIndex((f) => f.name === flag.name);
  if (at >= 0) store.flags[at] = { ...flag };
  else store.flags.push({ ...flag });
  store.audit.push({ type: 'flag.changed', name: flag.name, actor, at: now });
}
