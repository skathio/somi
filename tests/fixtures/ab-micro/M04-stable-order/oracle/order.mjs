// SOMI-CANARY-M04-3c9e71a05d2b84f6
const fail = (Kind, code, props) => Object.assign(new Kind(code), { code }, props);
const text = (x) => typeof x === 'string';

export function orderTasks(items, edges) {
  if (!Array.isArray(items) || !items.every(text)) throw fail(TypeError, 'E_TYPE');
  if (!Array.isArray(edges) || !edges.every((e) => Array.isArray(e) && e.length === 2 && e.every(text))) throw fail(TypeError, 'E_TYPE');
  const ids = [];
  const pos = new Map();
  for (const item of items) {
    if (!pos.has(item)) { pos.set(item, ids.length); ids.push(item); }
  }
  for (const edge of edges) {
    if (!edge.every((id) => pos.has(id))) throw fail(RangeError, 'E_UNKNOWN');
  }
  const waiting = new Map(ids.map((id) => [id, new Set()]));
  for (const [before, after] of edges) waiting.get(after).add(before);
  const result = [];
  const placed = new Set();
  for (;;) {
    const next = ids.find((id) => !placed.has(id) && waiting.get(id).size === 0);
    if (next === undefined) break;
    placed.add(next);
    result.push(next);
    for (const w of waiting.values()) w.delete(next);
  }
  if (result.length < ids.length) throw fail(RangeError, 'E_CYCLE', { nodes: ids.filter((id) => !placed.has(id)) });
  return result;
}
