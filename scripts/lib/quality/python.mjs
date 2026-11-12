// quality/python.mjs: what the gate looks for in Python beyond the shape of a function. Leftover debugging and a swallowed error are
// read from one file's tree (python-findings.mjs). An unused export needs the rest of the repository: a public name the change added is
// unused when no other file imports it (python-exports.mjs, python-imports.mjs).

import { filesAt } from '../git-tree.mjs';
import { languageOf, parseSource } from './parse.mjs';
import { exportsOf } from './python-exports.mjs';
import { pythonFindings } from './python-findings.mjs';
import { importsOf, isImported, literal } from './python-imports.mjs';

export { exportsOf, importsOf, isImported, pythonFindings };

const inAdded = (added, line) => added.some(([a, b]) => line >= a && line <= b);
// A package's __init__.py is its public face and __main__.py its entry point, so their names are meant for callers the gate cannot see.
const NOT_A_MODULE = /(^|\/)(__init__|__main__|conftest|setup)\.py$/;

/**
 * Python's own checks on what a change added to one file, for the gate. Findings go to ctx.violations or ctx.warnings. An export is
 * only remembered in ctx.pyExports: whether anything imports it is decided by scoreUnusedExports, once every file has been read.
 */
export function scorePython(ctx, { file, tree, added, test }) {
  for (const f of pythonFindings(tree, { test }).filter((x) => inAdded(added, x.line))) {
    const finding = { rule: f.rule, file, line: f.line, name: f.name, value: 1, limit: 0 };
    if (f.level === 'violation') ctx.violations.push(finding); else ctx.warnings.push(finding);
  }
  if (test || NOT_A_MODULE.test(file)) return;
  const text = ctx.after.get(file) ?? '';
  const usedHere = (name) => text.split(new RegExp(`\\b${literal(name)}\\b`)).length > 2;
  ctx.pyExports.push(...exportsOf(tree).filter((x) => inAdded(added, x.line) && (x.declared || !usedHere(x.name))).map((x) => ({ ...x, file })));
}

async function importsIn(file, text) {
  const parsed = await parseSource(file, text);
  try { return parsed?.tree ? importsOf(parsed.tree, file) : []; } finally { parsed?.tree?.delete(); }
}

/**
 * A public name the change added that no other file imports, reported as a warning: in an application it is dead code, but in a
 * library it can be the interface, and the gate cannot tell the two apart. Only files that mention one of the names are parsed.
 */
export async function scoreUnusedExports(ctx, { skipped, maxFiles }) {
  if (ctx.pyExports.length === 0) return;
  const mentioned = (text) => ctx.pyExports.some((x) => text.includes(x.name));
  const files = [...new Set([...ctx.repoFiles, ...ctx.after.keys()])].filter((f) => languageOf(f) === 'python' && !skipped.test(f)).slice(0, maxFiles);
  const others = [];
  for (const [file, text] of filesAt(ctx.root, ctx.to, files)) {
    if (mentioned(text)) others.push({ file, text, imports: await importsIn(file, text) });
  }
  for (const x of ctx.pyExports.filter((e) => !isImported(e.file, e.name, others))) ctx.warnings.push({ rule: 'unused-export', file: x.file, line: x.line, name: x.name, value: 1, limit: 0 });
}
