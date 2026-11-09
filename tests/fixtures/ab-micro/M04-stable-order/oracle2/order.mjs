// SOMI-CANARY-M04-3c9e71a05d2b84f6
const fail = (Kind, code, props) => Object.assign(new Kind(code), { code }, props);
const isText = (x) => typeof x === 'string';
const permutations = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
const lexLess = (p, q) => { for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] < q[i]; return false; };

// Brute force: every ordering of the distinct identifiers (as caller positions) that satisfies every edge; keep the
// lexicographically smallest. With none left there is a cycle, and the unplaceable identifiers come from a transitive closure.
export function orderTasks(items, edges) {
  if (!Array.isArray(items) || items.some((x) => !isText(x))) throw fail(TypeError, 'E_TYPE');
  if (!Array.isArray(edges) || edges.some((e) => !Array.isArray(e) || e.length !== 2 || !isText(e[0]) || !isText(e[1]))) throw fail(TypeError, 'E_TYPE');
  const ids = [...new Set(items)];
  const idx = (id) => ids.indexOf(id);
  if (edges.some(([b, a]) => idx(b) < 0 || idx(a) < 0)) throw fail(RangeError, 'E_UNKNOWN');
  let best = null;
  for (const perm of permutations(ids.map((_, i) => i))) {
    const slot = [];
    perm.forEach((p, k) => { slot[p] = k; });
    if (edges.every(([b, a]) => slot[idx(b)] < slot[idx(a)]) && (best === null || lexLess(perm, best))) best = perm;
  }
  if (best !== null) return best.map((p) => ids[p]);
  const n = ids.length;
  const reach = ids.map(() => ids.map(() => false));
  for (const [b, a] of edges) reach[idx(b)][idx(a)] = true;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (reach[i][k] && reach[k][j]) reach[i][j] = true;
  const stuck = ids.filter((_, v) => ids.some((_u, u) => reach[u][u] && (u === v || reach[u][v])));
  throw fail(RangeError, 'E_CYCLE', { nodes: stuck });
}
