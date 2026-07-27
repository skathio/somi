#!/usr/bin/env node
// scripts/generate-digest.mjs — regenerate the always-on digest copies from their canonical source.
//
// WHY THIS EXISTS
// The always-on digest lives in three places: rules/CLAUDE.md (canonical), AGENTS.md, and
// .github/copilot-instructions.md. They were hand-synced, and they drifted — the Copilot copy was
// missing the `Reasoning craft` bullet entirely, which `npm test` could not see. Hand-syncing three
// copies is what caused the drift, so this script makes the canonical the only editable one.
//
// WHAT IT DOES
// Reads the bullets between `<!-- digest:start -->` / `<!-- digest:end -->` in the canonical
// file and writes them into each target's own "## Always-on digest" section, adjusting the relative
// link prefix per target's directory depth (see TARGETS below). `--check` exits non-zero on any diff
// instead of writing, for CI (wired into scripts/validate.sh in phase 3, iteration 3.1).
//
// THE PREFIX ADJUSTMENT IS NOT THE WHOLE FIX
// A plan-review pass established that a link-prefix substitution ALONE cannot reproduce the copies:
// the canonical had no links at all, so there was no prefix to substitute. Phase 2 iteration 2.2
// normalized the canonical to full markdown links FIRST; only then does a per-file prefix adjustment
// become sufficient. Both halves are required — this script is the second half.
//
// MARKER PLACEMENT is pinned deliberately: the markers wrap ONLY the digest bullets, not the
// heading and not the framing paragraph. Two consumers depend on that. This generator inserts
// bullets under each target's own existing heading (neither target has a framing paragraph today,
// and adding one silently would be a content change nobody asked for). The UserPromptSubmit hook
// (phase 1, iteration 1.2) injects the same bullets into a consuming project's context, where a
// repeated heading is pure token cost. One marker pair serves both.
//
// CONSUMER-CONTEXT CAVEAT (the seam this script deliberately does NOT own): the hook strips these
// markdown links back to bare `(NN)` codes before injecting, because no repo-relative path resolves
// in a consuming project — SoMi's rules/ lives in the plugin install directory. That stripping is
// iteration 1.2's job, at the point of extraction. Loosening the canonical's citation style to suit
// a consumer this file is never injected into would fix the symptom in the wrong place.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = 'rules/CLAUDE.md';
const START = '<!-- digest:start -->';
const END = '<!-- digest:end -->';
const HEADING = '## Always-on digest';

// Each target's link prefix. The canonical sits at rules/CLAUDE.md and cites `./NN-*.md` —
// FILE-relative, and the only form that resolves from inside rules/. (`./rules/NN-*.md` would
// resolve to rules/rules/ — a dead link. That mistake shipped once here, and it passed review
// because the hook's citation stripper happened to require the `rules/` segment, so a broken
// canonical was the only thing that round-tripped. Both are fixed; this comment is the guard.)
// AGENTS.md is at the repo root, so it needs `./rules/`; .github/copilot-instructions.md is one
// level down, so it needs `../rules/`. Getting this wrong produces links that render but 404 — the
// exact silent failure this work item exists to remove, so it is data here rather than a guess.
const TARGETS = [
  { file: 'AGENTS.md', prefix: './rules/' },
  { file: '.github/copilot-instructions.md', prefix: '../rules/' },
];

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// The canonical bullets, verbatim, between the markers. Throws rather than silently emitting an
// empty digest — a generator that quietly writes nothing is worse than one that fails loudly.
function canonicalBullets() {
  const src = read(CANONICAL);
  const i = src.indexOf(START);
  const j = src.indexOf(END);
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`${CANONICAL}: missing or malformed ${START} / ${END} markers`);
  }
  const body = src.slice(i + START.length, j).trim();
  if (body === '') throw new Error(`${CANONICAL}: digest block is empty`);
  return body;
}

// Retarget the canonical's bare `./NN-*.md` to the prefix this target needs. Only the link TARGET
// is rewritten, never the label — so ``[`00`](./00-priorities.md)`` keeps its `00` label intact.
function retarget(bullets, prefix) {
  // ANCHORED on the citation shape (`./NN-name.md`), not on any `](./`. An unanchored pattern
  // rewrites every relative link in a bullet: a prose link like `[guide](./docs/ADOPTION.md)`
  // became `./rules/docs/ADOPTION.md` — dead — while `--check` reported both copies in sync.
  // The hook's F-37 fix exists specifically to keep prose links in bullets intact, so an
  // unanchored rewrite here put the two halves of the seam in disagreement about what is legal.
  return bullets.replace(/\]\(\.\/(\d{2}-[A-Za-z0-9-]+\.md)\)/g, `](${prefix}$1)`);
}

// Replace everything between the target's `## Always-on digest` heading and the next `## ` heading
// (or EOF) with the generated bullets.
//
// Anchoring is LINE-ANCHORED and FENCE-AWARE, and a second heading match is an error rather than a
// silent pick. A substring search got all three wrong, and each failure corrupted the file while
// `--check` still reported "in sync" — a generator built to eliminate silent drift must not be able
// to manufacture it:
//   - prose merely MENTIONING "## Always-on digest" above the real heading hijacked the anchor,
//     truncating that sentence mid-word and deleting the real section;
//   - a `## ` line inside a fenced code block terminated the splice early, swallowing the opening
//     fence and leaving it unbalanced;
//   - two headings would silently take the first.
function splice(targetSrc, bullets) {
  const lines = targetSrc.split('\n');
  const headingRe = /^## Always-on digest[ \t]*$/;
  const nextHeadingRe = /^## /;

  // Fenced regions are invisible to both anchors. Tracked by toggling on ``` / ~~~ at line start.
  const fenced = new Set();
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) fenced.add(i);
  });

  const heads = lines.map((l, i) => (headingRe.test(l) && !fenced.has(i) ? i : -1)).filter((i) => i >= 0);
  if (heads.length === 0) throw new Error(`missing "${HEADING}" heading`);
  if (heads.length > 1) {
    throw new Error(`"${HEADING}" appears ${heads.length} times (lines ${heads.map((i) => i + 1).join(', ')}) — ambiguous`);
  }

  const h = heads[0];
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    if (nextHeadingRe.test(lines[i]) && !fenced.has(i)) { end = i; break; }
  }
  const tail = end === lines.length ? '' : `\n${lines.slice(end).join('\n')}`;
  return `${lines.slice(0, h + 1).join('\n')}\n\n${bullets}\n${tail}`;
}

function main() {
  const check = process.argv.includes('--check');

  // A malformed canonical is a config error, not a crash. Without this the script exits on an
  // unhandled exception with a stack trace — technically non-zero, so CI would still fail, but the
  // operator sees a Node traceback instead of the one line that tells them what to fix. Found by
  // mutating the end marker and reading what the script actually printed.
  let bullets;
  try {
    bullets = canonicalBullets();
  } catch (err) {
    console.error(`generate-digest: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let drifted = 0;

  for (const { file, prefix } of TARGETS) {
    const current = read(file);
    let next;
    try {
      next = splice(current, retarget(bullets, prefix));
    } catch (err) {
      console.error(`generate-digest: ${file}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (next === current) continue;
    drifted++;
    if (check) {
      console.error(`generate-digest: DRIFT in ${file} — regenerate with \`node scripts/generate-digest.mjs\``);
    } else {
      fs.writeFileSync(path.join(REPO_ROOT, file), next);
      console.log(`generate-digest: updated ${file}`);
    }
  }

  if (check) {
    if (drifted > 0) {
      console.error(`generate-digest: ${drifted} file(s) out of sync with ${CANONICAL}`);
      process.exitCode = 1;
    } else {
      console.log(`generate-digest: all ${TARGETS.length} copies match ${CANONICAL}`);
    }
  } else if (drifted === 0) {
    console.log('generate-digest: already in sync, nothing to write');
  }
}

main();
