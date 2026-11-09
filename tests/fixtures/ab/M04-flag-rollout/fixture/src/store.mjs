export function createStore({ clock } = {}) {
  if (typeof clock !== 'function') throw new TypeError('createStore needs a clock');
  return { clock, flags: new Map(), audit: [], unknown: [] };
}
