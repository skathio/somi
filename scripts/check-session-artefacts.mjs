#!/usr/bin/env node
// scripts/check-session-artefacts.mjs — fail the build when shipped code or prose points at the
// maintainers' gitignored `.somi/` planning folder.
//
// A comment that says "see the plan's third decision" or "the review finding numbered 28" is a
// dangling pointer for everyone who clones the repo: the plan and the ledger are not shipped, so
// the reader cannot resolve it. State the reasoning in words instead, or delete the comment.
//
// WHAT COUNTS
// A reference that only resolves inside `.somi/`: a finding id with two or more digits, a decision
// tag, an iteration or phase number from a plan, a `decisions.md#` anchor, a planning-slug name.
// Single-digit finding ids (the CLI usage examples) are domain text and pass.
//
// "phase" and "work item" are deliberately NOT banned as words — they are SoMi product vocabulary
// (a pipeline stage; a planning unit users create). Only a numbered phase/iteration, or the phrase
// "this work item" in a code comment (which can only mean the maintainers' own planning item),
// counts.
//
// WHERE
//   - code (`.mjs`, `.sh`) under hooks/ and scripts/: comment text only, so a string literal that
//     legitimately mentions a decision tag is not flagged.
//   - markdown under agents/, commands/, skills/: every line, with a narrower pattern, because
//     those files teach the plan format and use `D1:` / `phase 1, iteration 1` as sample content.
//
// EXCLUSIONS are explicit and few (EXCLUDED below). To gate another tree, add one SCOPES row.

import fs from 'node:fs';
import path from 'node:path';

const FINDING = String.raw`\bF-?\d{2,}\b`;
const DECISION_ANCHOR = String.raw`decisions\.md#`;
const PLAN_SLUG = String.raw`node-runtime-port|somi-3-0-rework`;

const CODE_PATTERN = new RegExp(
  [
    FINDING,
    String.raw`\bD\d+[a-z]?\b`,
    DECISION_ANCHOR,
    String.raw`\b[Ii]teration \d`,
    String.raw`\b[Pp]hase[ -]\d`,
    String.raw`\bphases/\d`,
    String.raw`\b\d\.\d+[a-z]?(?:'s)? pass \d`,
    String.raw`\b\d\.\d{1,2}[a-z]?'s\b`,
    String.raw`\b\d\.\d{1,2}[a-z]?[/+-]\d\.\d{1,2}\b`,
    String.raw`\(\d\.\d{1,2}[a-z]?[,)]`,
    String.raw`\b(?:this|that) iteration\b`,
    String.raw`\breviewer-blessed\b`,
    String.raw`\b(?:the|see|in the) diary\b`,
    String.raw`\bphase file\b`,
    String.raw`\b(?:spec|context|brief)\.md §`,
    String.raw`\bthis work[ -]item\b`,
    PLAN_SLUG,
  ].join('|'),
);

const MARKDOWN_PATTERN = new RegExp(
  [
    FINDING,
    String.raw`\(D\d+[a-z]?\)`,
    String.raw`\bD\d+[a-z]?'s\b`,
    DECISION_ANCHOR,
    PLAN_SLUG,
  ].join('|'),
);

// One row per gated tree. Adding `tests/scripts` later is a one-line change here.
const SCOPES = [
  { dir: 'hooks', kind: 'code' },
  { dir: 'scripts', kind: 'code' },
  { dir: 'agents', kind: 'markdown' },
  { dir: 'commands', kind: 'markdown' },
  { dir: 'skills', kind: 'markdown' },
];

// Repo-relative paths (file or directory prefix). The checker holds its own pattern definitions.
const EXCLUDED = [
  'scripts/check-session-artefacts.mjs',
  'tests/evals/results',
  'CHANGELOG.md',
];

const CODE_EXT = new Set(['.mjs', '.sh']);

function isExcluded(rel) {
  return EXCLUDED.some((e) => rel === e || rel.startsWith(`${e}/`));
}

function* walk(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const child = path.posix.join(rel, entry.name);
    if (isExcluded(child)) continue;
    if (entry.isDirectory()) yield* walk(root, child);
    else if (entry.isFile()) yield child;
  }
}

function commentText(line, ext) {
  const trimmed = line.trim();
  if (ext === '.sh') {
    if (trimmed.startsWith('#!')) return null;
    if (trimmed.startsWith('#')) return trimmed;
    const at = line.search(/\s#\s/);
    return at === -1 ? null : line.slice(at);
  }
  if (/^(\/\/|\/\*|\*)/.test(trimmed)) return trimmed;
  const at = line.search(/\s\/\/\s/);
  return at === -1 ? null : line.slice(at);
}

export function findArtefacts(root) {
  const hits = [];
  for (const { dir, kind } of SCOPES) {
    for (const rel of walk(root, dir)) {
      const ext = path.extname(rel);
      if (kind === 'code' && !CODE_EXT.has(ext)) continue;
      if (kind === 'markdown' && ext !== '.md') continue;
      const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const text = kind === 'code' ? commentText(line, ext) : line;
        const pattern = kind === 'code' ? CODE_PATTERN : MARKDOWN_PATTERN;
        if (text !== null && pattern.test(text)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootIdx = process.argv.indexOf('--root');
  const root = rootIdx === -1 ? process.cwd() : path.resolve(process.argv[rootIdx + 1]);
  const hits = findArtefacts(root);
  if (hits.length > 0) {
    console.error('SESSION-ARTEFACT REFERENCES (point into the gitignored .somi/ folder):');
    for (const h of hits) console.error(`  ${h}`);
    console.error(`${hits.length} line(s). Say the reason in plain words, or delete the comment.`);
    process.exit(1);
  }
  console.log('  ok: no session-artefact references in gated paths');
}
