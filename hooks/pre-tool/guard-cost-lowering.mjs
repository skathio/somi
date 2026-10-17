#!/usr/bin/env node
// hooks/pre-tool/guard-cost-lowering.mjs — PreToolUse hook (matcher: Write|Edit|MultiEdit|mcp__.*somi_config)
// — ask the USER before a change that lowers a cost tier.
//
// A model steered by injected text could lower security-reviewer or the ceiling through the somi_config
// MCP tool or by editing .somi/config.json, and the warning would only reach that model. This hook
// computes what the change would do and, if it lowers any agent's effective tier (see
// scripts/lib/cost-lowering.mjs for the exact rules), answers permissionDecision "ask" with a plain-text
// reason built from fixed strings. Raises and no-ops are silent, and so is every unrelated tool call.
//
//   - somi_config (set|unset): `after` = the current config with tool_input applied by the shared edit
//     lib (scripts/lib/cost-config-edit.mjs), so the hook and the tool cannot disagree on meaning.
//   - Write / Edit / MultiEdit of <project>/.somi/config.json (the path is resolved against the project
//     root, so `.somi/../.somi/config.json` and a symlinked .somi resolve to the same file): `after` = the
//     written content, or the current text with the edits applied exactly as the Edit tool would.
//
// Fail closed to the user: for a config-file path, any inability to evaluate (unreadable or unparsable
// content, an edit that does not apply, an exception) asks. Nothing from any file is ever echoed.
// Accepted limits: a model with an approved Bash tool can still edit the file by other means; the
// somi_config tool's own refusal (--refuse-lowering) covers hosts where this hook does not run.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPayload, field, askPretool, HookExit, projectRoot } from '../lib/common.mjs';

const LIB = path.join(import.meta.dirname, '..', '..', 'scripts', 'lib');
const UNEVALUABLE = 'SoMi: this change to .somi/config.json could not be evaluated, so it needs your confirmation.';
const OUTSIDE = 'SoMi: this call names a project directory outside the project root, so it needs your confirmation.';
const STATE_WRITE = 'SoMi: this writes the persisted cost ceiling (.somi/somi-state/ceiling.json), which can lower the ceiling, so it needs your confirmation.';
const RESOLVE_LOWER = 'SoMi: this somi_resolve call sets a session ceiling lower than the current one, so it needs your confirmation.';
const SECURITY_ONLY = 'SoMi: after this change security-reviewer would run below high (it is not pinned to high). Confirm only if you intend that.';
const reasonFor = (reasons, REASONS) => (reasons.length === 1 && reasons[0] === REASONS.security
  ? SECURITY_ONLY
  : `SoMi: this change lowers a cost setting (${reasons.join('; ')}). Confirm only if you intend it.`);

const realOrNull = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const statOrNull = (p) => { try { return fs.statSync(p); } catch { return null; } };
const same = (a, b) => a !== null && b !== null && a.dev === b.dev && a.ino === b.ino;

// Is `target` (as given by the tool) the project's .somi/config.json? Decided by identity, not spelling:
//   - it is the same file (dev/ino, following links), or
//   - its nearest existing ancestor is the same directory as <root>/.somi and the rest is config.json
//     (any case), or that ancestor is the root itself and the rest is .somi/config.json (any case), so an
//     absent file, an absent .somi, a symlinked .somi, an aliased root and a case-insensitive filesystem
//     are all caught, or
//   - lexically it is <root>/.somi/config.json in any letter case (fail closed when nothing resolves).
//   `segs` is the file's path below the root: ['.somi', 'config.json'] or ['.somi', 'somi-state', 'ceiling.json'].
function isProjectPath(root, target, segs) {
  const lexical = path.resolve(root, target);
  if (same(statOrNull(lexical), statOrNull(path.join(root, ...segs)))) return true;
  let anc = lexical; const rest = [];
  while (statOrNull(anc) === null && path.dirname(anc) !== anc) { rest.unshift(path.basename(anc)); anc = path.dirname(anc); }
  const low = rest.map((x) => x.toLowerCase());
  const ancStat = statOrNull(anc);
  const n = low.length;
  if (n >= 1 && n <= segs.length && low.join('/') === segs.slice(segs.length - n).join('/') && same(ancStat, statOrNull(path.join(root, ...segs.slice(0, segs.length - n))))) return true;
  const rel = path.relative(root, lexical).split(path.sep).map((x) => x.toLowerCase());
  return rel.join('/') === segs.join('/');
}
const isConfigPath = (root, target) => isProjectPath(root, target, ['.somi', 'config.json']);
const isStatePath = (root, target) => isProjectPath(root, target, ['.somi', 'somi-state', 'ceiling.json']);

// The project directory a somi_config / somi_resolve call acts on: project_dir when it resolves to the root
// or inside it, the root when none is given; anything else is something the hook cannot evaluate: ask.
function narrowedDir(payload, input, root) {
  if (input.project_dir === undefined) return root;
  const dir = typeof input.project_dir === 'string' && path.isAbsolute(input.project_dir) ? realOrNull(input.project_dir) : null;
  const host = realOrNull(root);
  if (!dir || !host || !(dir === host || dir.startsWith(host + path.sep))) askPretool(payload, OUTSIDE);
  return dir;
}

// The Edit tool's rule: old_string must occur (once, unless replace_all). Returns the new text or null.
function applyOneEdit(text, e) {
  if (typeof e?.old_string !== 'string' || typeof e?.new_string !== 'string' || e.old_string === '') return null;
  const n = text.split(e.old_string).length - 1;
  if (n === 0 || (n > 1 && e.replace_all !== true)) return null;
  return e.replace_all === true ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);
}

function readCurrent(readTextFile, file) {
  try { return readTextFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// somi_resolve({ceiling}) persists a CLI-style ceiling; one below the ceiling in force needs the user.
async function resolveCheck(payload, input, root) {
  if (input.ceiling === undefined) return;
  const dir = narrowedDir(payload, input, root);
  try {
    const [{ readTextFile, loadState, DEFAULT_CEILING }, { VALID_COSTS }] = await Promise.all(
      ['cost-ceiling', 'cost-model'].map((m) => import(pathToFileURL(path.join(LIB, `${m}.mjs`)).href)),
    );
    if (!VALID_COSTS.includes(input.ceiling)) return; // the tool rejects it itself
    const text = readCurrent(readTextFile, path.join(dir, '.somi', 'config.json'));
    const cfg = text === null ? {} : JSON.parse(text);
    const state = loadState(dir);
    const effective = VALID_COSTS.includes(cfg?.cost?.ceiling) ? cfg.cost.ceiling
      : (state && ['cli', 'env'].includes(state.ceiling_origin) ? state.ceiling : DEFAULT_CEILING);
    if (VALID_COSTS.indexOf(input.ceiling) < VALID_COSTS.indexOf(effective)) askPretool(payload, RESOLVE_LOWER);
  } catch (e) {
    if (e instanceof HookExit) throw e;
    askPretool(payload, RESOLVE_LOWER);
  }
}

async function main() {
  const payload = readPayload();
  const tool = field(payload, 'tool_name');
  const input = payload?.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const isMcp = /^mcp__.*somi_config$/.test(tool) || tool === 'somi_config';
  const isResolve = /^mcp__.*somi_resolve$/.test(tool) || tool === 'somi_resolve';
  const isFileTool = tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit';
  if (!isMcp && !isFileTool && !isResolve) return;

  const root = projectRoot();
  if (isResolve) return resolveCheck(payload, input, root);
  // Any write to the persisted ceiling file asks: it is the other way to lower the ceiling.
  if (isFileTool && typeof input.file_path === 'string' && input.file_path !== '' && isStatePath(root, input.file_path)) askPretool(payload, STATE_WRITE);
  let projDir = root; // the directory whose config is evaluated (and whose persisted ceiling applies)
  if (isMcp) {
    if (input.action !== 'set' && input.action !== 'unset') return;
    // The tool writes into project_dir when it narrows the host root; evaluate THAT config. A project_dir
    // that does not resolve to the root or a directory inside it is something the hook cannot evaluate: ask.
    projDir = narrowedDir(payload, input, root);
  } else {
    const target = input.file_path;
    if (typeof target !== 'string' || target === '' || !isConfigPath(root, target)) return;
  }
  const file = path.join(projDir, '.somi', 'config.json');

  // From here the call is about the project config: any failure asks.
  try {
    const [{ readTextFile }, { applyEdit, EditError }, { lowers, REASONS }] = await Promise.all(
      ['cost-ceiling', 'cost-config-edit', 'cost-lowering'].map((m) => import(pathToFileURL(path.join(LIB, `${m}.mjs`)).href)),
    );
    const currentText = readCurrent(readTextFile, file);
    let before = {};
    if (currentText !== null) { try { before = JSON.parse(currentText); } catch { before = {}; } }
    let after;
    if (isMcp) {
      try { after = applyEdit(currentText === null ? null : JSON.parse(currentText), { action: input.action, key: input.key, value: input.value }).next; } catch (e) {
        if (e instanceof EditError) return; // the tool rejects this call itself; nothing would change
        throw e;
      }
    } else if (tool === 'Write') {
      if (typeof input.content !== 'string') throw new Error('no content');
      after = JSON.parse(input.content);
    } else {
      let text = currentText ?? '';
      const edits = tool === 'MultiEdit' ? input.edits : [input];
      if (!Array.isArray(edits)) throw new Error('no edits');
      for (const e of edits) {
        text = applyOneEdit(text, e);
        if (text === null) throw new Error('edit does not apply');
      }
      after = JSON.parse(text);
    }
    const verdict = lowers(before, after, projDir);
    if (verdict.lowers) askPretool(payload, reasonFor(verdict.reasons, REASONS));
  } catch (e) {
    if (e instanceof HookExit) throw e;
    askPretool(payload, UNEVALUABLE);
  }
}

// Exit 0 on every path: a HookExit is the question already asked, anything else is silence.
main().then(() => {}, () => {}).finally(() => { process.exitCode = 0; });
