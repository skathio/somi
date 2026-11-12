// quality/coupling.mjs: how a change ties the modules of a repository together. Each rule compares the import graph after the change
// with the one before it, so a codebase that is already tangled is not failed for it:
// - cycle: a change may not add an import that closes a loop between modules that did not reach each other before. One that only adds
//   another edge inside a loop that was already there is advice.
// - forbidden-import: a project or the user may name folders that must not import others, and a new import across that line fails.
// - import-fan-out: a module that something imports should not come to depend on too many others. It is advice.
// Only runtime imports count toward a cycle or the fan-out: a type-only import is gone when the code runs.

import { importGraph } from './imports.mjs';
import { report } from './findings.mjs';
import { scoreExports } from './exports.mjs';

const runtime = (edges = []) => edges.filter((e) => !e.typeOnly);

/** The path from one module to another along runtime imports, or null when there is none. */
function pathBetween(graph, from, to) {
  const back = new Map([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift();
    if (at === to) {
      const out = [];
      for (let n = to; n !== null; n = back.get(n)) out.unshift(n);
      return out;
    }
    for (const e of runtime(graph.get(at))) if (!back.has(e.to)) { back.set(e.to, at); queue.push(e.to); }
  }
  return null;
}

// The graph before the change: every untouched file as it is now, each touched file as it was, gone if the change added it, and each
// deleted file as it was. A file the change moved keeps its new name, so a loop that was only renamed is one that was already there.
function graphBefore(ctx, after, files) {
  const before = new Map(after);
  const known = new Set(files);
  const { touched, deleted, renames } = ctx.coupling;
  for (const file of touched) {
    before.delete(file);
    known.delete(file);
  }
  const old = new Map([...touched, ...deleted].filter((f) => ctx.before.has(f)).map((f) => [f, ctx.before.get(f)]));
  for (const file of old.keys()) known.add(file);
  const named = (f) => renames.get(f) ?? f;
  for (const [file, edges] of importGraph(old, known)) before.set(named(file), edges.map((e) => ({ ...e, to: named(e.to) })));
  return before;
}

function scoreEdge(ctx, { file, edge, after, before }) {
  const rule = ctx.forbid.find((r) => file.startsWith(r.from) && edge.to.startsWith(r.to));
  if (rule) ctx.violations.push({ rule: 'forbidden-import', file, line: 1, value: 1, limit: 0, other: { file: edge.to, line: 1 }, reason: `${rule.from} may not import ${rule.to}` });
  if (edge.typeOnly || ctx.isTest(edge.to)) return;
  const loop = pathBetween(after, edge.to, file);
  if (!loop) return;
  const cycle = [file, ...loop].join(' -> ');
  // The loop was already there when the two modules reached each other before the change.
  const tangled = pathBetween(before, edge.to, file) && pathBetween(before, file, edge.to);
  report(ctx, { rule: tangled ? 'cycle-grown' : 'cycle', file, line: 1, value: loop.length, limit: 0, reason: cycle });
}

function fanOut(graph, file, isTest) {
  return new Set(runtime(graph.get(file)).map((e) => e.to).filter((f) => !isTest(f))).size;
}

function scoreFanOut(ctx, { file, after, before, importers }) {
  const now = fanOut(after, file, ctx.isTest);
  const was = fanOut(before, file, ctx.isTest);
  const limit = ctx.limits.imports.fan_out;
  if (now > limit && was <= limit && (importers.get(file)?.length ?? 0) > 0) report(ctx, { rule: 'import-fan-out', file, line: 1, value: now, limit, before: was });
}

// The modules that import each module, with the names each one takes.
function importersOf(graph) {
  const importers = new Map();
  for (const [from, edges] of graph) {
    for (const e of edges) { if (!importers.has(e.to)) importers.set(e.to, []); importers.get(e.to).push({ from, names: e.names }); }
  }
  return importers;
}

// The imports a touched module did not have before, each target once for runtime and once for type-only imports.
function newEdges(file, after, before) {
  const had = new Set((before.get(file) ?? []).map((e) => `${e.typeOnly}:${e.to}`));
  const runtimeHad = new Set(runtime(before.get(file)).map((e) => e.to));
  const seen = new Set();
  return after.get(file).filter((e) => {
    const key = `${e.typeOnly}:${e.to}`;
    const fresh = !seen.has(key) && !had.has(key) && !(e.typeOnly && runtimeHad.has(e.to));
    seen.add(key);
    return fresh;
  });
}

/** Every coupling rule on the touched product modules. texts is every JavaScript and TypeScript file of the repository after the change. */
export function scoreCoupling(ctx, texts, renames = new Map()) {
  ctx.coupling.renames = renames;
  const files = new Set(texts.keys());
  const after = importGraph(texts, files);
  const before = graphBefore(ctx, after, files);
  const importers = importersOf(after);
  for (const file of ctx.coupling.touched.filter((f) => after.has(f) && !ctx.isTest(f))) {
    for (const edge of newEdges(file, after, before)) scoreEdge(ctx, { file, edge, after, before });
    scoreFanOut(ctx, { file, after, before, importers });
  }
  for (const { file, names } of ctx.coupling.exports) scoreExports(ctx, { file, names, importers });
}
