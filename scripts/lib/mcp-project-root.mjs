// mcp-project-root.mjs — resolves the CONSUMING project's root for scripts/somi-mcp.mjs's
// `somi_resolve` tool. An MCP server is launched once, at session start, from the plugin's own
// location, so scripts/somi-dispatch.mjs's own projectRoot() (CLAUDE_PROJECT_DIR, else this
// PROCESS's cwd) is unsafe to reuse: neither host's docs confirm the server's launch-time cwd is
// the user's project rather than the plugin's own install dir. No cwd fallback here — that would
// risk silently resolving to SoMi's own repo, the exact failure this module exists to rule out.
//
// Two kinds of root:
//   - a HOST root: `CLAUDE_PROJECT_DIR` (this process's own env — tried first, no round trip) or
//     the client's MCP `roots/list` answer. Neither is text a model wrote.
//   - `project_dir`: a tool argument — text a MODEL supplied, validated (`validateDir()` below)
//     either way, but validity alone is no longer sufficient once a host root exists.
//
// Precedence: a HOST root, once established, is the one thing `project_dir` cannot override — it
// can only narrow it (select a subdirectory, e.g. a nested project in a workspace).
//   - host root + project_dir given -> project_dir must realpath to that root or inside it, or
//     refused (64) before anything is read or written; passing -> project_dir itself is used.
//   - host root, no project_dir -> the host root is used directly.
//   - no host root, project_dir given -> project_dir alone decides (the only case a model's text
//     still governs outright, since nothing more authoritative was offered).
//   - no host root, no project_dir -> refuse (67 — reuses dispatch-resolver.mjs's own family;
//     see its header). Never a cwd fallback.
//
// `roots/list` can answer with more than one root. A single one behaves like any host root above;
// more than one is ambiguous by itself, resolved only if project_dir selects exactly one of them.
//
// Every `roots/list` URI must be a `file:` URI — anything else is dropped, never treated as a path
// (an earlier shape of this file hand-stripped a literal `file://` prefix and left anything else
// untouched, so a non-file URI resolved relative to the server's own cwd). Decoded with
// `url.fileURLToPath` (handles percent-encoding and a `file://host/` authority correctly, unlike
// hand-slicing), then validated like `project_dir`: a root that doesn't exist is rejected, never
// silently created by whatever writes to it downstream (cost-ceiling.mjs's saveState mkdir -p's).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_USAGE, EXIT_PROJECT_ENV } from './dispatch-resolver.mjs';

// Structural check only (absolute, exists, a directory) — shared by `project_dir` and every
// `roots/list` candidate so the two can't drift on what counts as usable. Returns a reason, not a
// ready-made error: the two call sites attribute a bad value to a different code (project_dir is
// caller/model text -> 64; a bad roots/list entry is the HOST's own environment -> 67).
function validateDir(dir) {
  if (typeof dir !== 'string' || dir === '') return { ok: false, reason: 'empty' };
  if (!path.isAbsolute(dir)) return { ok: false, reason: 'not-absolute' };
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!st.isDirectory()) return { ok: false, reason: 'not-a-directory' };
  return { ok: true, dir };
}

function realpathOrNull(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return null;
  }
}

// Resolves the host's own root, if it supplies one. Returns undefined when the host supplies
// nothing usable, else `{ dirs, source }` — `dirs` is always an array (length 1 for env / a single
// root) so the caller has one shape to bound project_dir against either way.
async function hostRoot({ listRoots }) {
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  // Mirrors somi-dispatch.mjs's own projectRoot(): an unexpanded `${...}` placeholder is not real.
  if (envRoot && !envRoot.includes('${')) {
    return { dirs: [envRoot], source: 'env' };
  }

  if (!listRoots) return undefined;
  let rawRoots;
  try {
    rawRoots = await listRoots();
  } catch {
    rawRoots = undefined;
  }
  if (!Array.isArray(rawRoots)) return undefined;

  const dirs = [];
  for (const uri of rawRoots) {
    if (typeof uri !== 'string' || !uri.startsWith('file:')) continue; // non-file: dropped
    let p;
    try {
      p = fileURLToPath(uri); // decodes percent-encoding; handles a file://host/ authority
    } catch {
      continue; // malformed file: URI -- dropped, not guessed at
    }
    dirs.push(p);
  }
  return dirs.length > 0 ? { dirs, source: 'roots' } : undefined;
}

/**
 * @param {object} opts
 * @param {string} [opts.projectDirArg] - the tool call's own `project_dir` argument, if given.
 * @param {() => Promise<string[]|undefined>} [opts.listRoots] - calls the client's `roots/list`
 *   and returns the raw URI strings, or `undefined` when the client never declared `roots`.
 * @returns {Promise<{ok: true, root: string, source: string} | {ok: false, code: number, message: string}>}
 */
export async function resolveProjectRoot({ projectDirArg, listRoots }) {
  // Validated FIRST regardless of whether a host root exists -- a malformed value is 64 either
  // way, and the bounding check below needs a real, fs-verified directory to compare against.
  let projectDir; // undefined (not given), or the validated absolute path
  if (projectDirArg !== undefined) {
    const v = validateDir(projectDirArg);
    if (!v.ok) {
      const reason = {
        empty: `project_dir requires a non-empty string, got ${JSON.stringify(projectDirArg)}`,
        'not-absolute': `project_dir must be an absolute path, got ${JSON.stringify(projectDirArg)}`,
        missing: `project_dir ${JSON.stringify(projectDirArg)} does not exist`,
        'not-a-directory': `project_dir ${JSON.stringify(projectDirArg)} is not a directory`,
      }[v.reason];
      return { ok: false, code: EXIT_USAGE, message: reason };
    }
    projectDir = v.dir;
  }

  const host = await hostRoot({ listRoots });

  if (!host) {
    // Host supplies nothing: project_dir alone decides.
    if (projectDir) return { ok: true, root: projectDir, source: 'project_dir' };
    return {
      ok: false,
      code: EXIT_PROJECT_ENV,
      message:
        'no project root could be established: CLAUDE_PROJECT_DIR is unset, the client offered no ' +
        'MCP roots (or none were returned), and no project_dir argument was given -- pass ' +
        'project_dir explicitly; this never falls back to the SoMi install directory',
    };
  }

  // Each host-offered candidate must itself exist as a directory -- an entry that fails is
  // dropped, not treated as its own hard error (a multi-folder client can legitimately offer one
  // root this process can't see). CLAUDE_PROJECT_DIR's single candidate failing is exactly "a
  // root that doesn't exist", refused below like any other.
  const validCandidates = host.dirs
    .map((d) => validateDir(d))
    .filter((v) => v.ok)
    .map((v) => v.dir);

  if (validCandidates.length === 0) {
    return {
      ok: false,
      code: EXIT_PROJECT_ENV,
      message: `the host-supplied root (${host.source}) does not resolve to an existing directory -- refusing rather than creating one`,
    };
  }

  if (!projectDir) {
    if (validCandidates.length > 1) {
      return {
        ok: false,
        code: EXIT_PROJECT_ENV,
        message: `ambiguous: the client offered ${validCandidates.length} MCP roots and no project_dir was given to select one`,
      };
    }
    return { ok: true, root: validCandidates[0], source: host.source };
  }

  // A host root exists AND project_dir is given: it must realpath to one of the host's own
  // candidates, or inside one -- a model argument narrows the host's root, never overrides it.
  const projectDirReal = realpathOrNull(projectDir);
  const matches = projectDirReal !== null && validCandidates.some((c) => {
    const candidateReal = realpathOrNull(c);
    if (candidateReal === null) return false;
    return projectDirReal === candidateReal || projectDirReal.startsWith(candidateReal + path.sep);
  });
  if (!matches) {
    return {
      ok: false,
      code: EXIT_USAGE,
      message:
        `project_dir "${projectDir}" is outside the host-supplied root -- refusing (project_dir ` +
        `may only select a directory inside the host's own root, never override it)`,
    };
  }
  return { ok: true, root: projectDir, source: 'project_dir' };
}
