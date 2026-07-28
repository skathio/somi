#!/usr/bin/env node
// scripts/check-links.mjs — fail the build on a relative markdown link whose target doesn't exist.
//
// WHY A SEPARATE SCRIPT
// A ~120-line walker inside a `validate.sh` heredoc would be unreadable and untestable, and the
// repo already has the pattern of validate.sh invoking a focused Node script (generate-digest.mjs).
// Recorded as a scope addition in the phase file rather than done quietly.
//
// WHAT IT WALKS
// Every git-tracked `*.md`, minus `CHANGELOG.md` (generated release history — the same exclusion
// spec.md §6 and phase 1 iteration 1.1's rename greps use). `.somi/` needs no filter: it is
// gitignored, so `git ls-files` can never produce a path inside it.
//
// FENCED AND INLINE CODE ARE SKIPPED — this is the whole correctness story.
// A plan-review pass ran a fence-blind walker, recorded "7 links across 3 files fail today", and
// built an escape-hatch policy around that inventory. **Four of the seven were sample content
// inside a ```markdown fence** in examples/feature-plan-example.md — displayed source, not links;
// no renderer resolves them. Marking them wrote a SoMi-internal CI token into the rendered body of
// the canonical example spec, which ships in the npm tarball and is what users copy. With fence
// awareness the repo has ZERO non-resolving links. A checker that flags displayed source teaches
// people to silence it, which is worse than not having it.
//
// SCANS WHOLE FILE CONTENT, NOT LINE BY LINE.
// A per-line scan cannot see a link whose text wraps across lines — and this repo hard-wraps prose
// at ~100 characters, so `See [the write-discipline contract in the reviewer\nagent](../x.md)` would
// pass forever. Phase 3 iteration 3.1 paid for exactly this blind spot once already (a single-line
// grep undercounted a 12-item inventory as 11 because one claim wrapped). Reference-style links
// (`[text][ref]` + `[ref]: ./path`) are resolved too.
//
// THE illustrative-path ESCAPE HATCH, deliberately narrowed.
// THIRD RESORT, not first. Before reaching for a marker: (1) if the text need not be a link, make
// it an inline code span — iteration 1.3 resolved the real `examples/sample-consumer/` case that
// way, and a non-link cannot rot; (2) if it is displayed sample source, put it in a fence, which
// this walker now skips. Mark only when the link must stay a live link and its target genuinely
// lives outside this repo.
//
// The marker sits on the SAME LINE, immediately before the link:
//
//     <!-- illustrative-path -->[text](./path.md)
//
// Two constraints keep it from becoming a blanket, both added after review:
//   1. **Scoped to `examples/`.** A marker anywhere else FAILS rather than exempts. Silencing a
//      genuinely broken link would otherwise be a 26-character insertion mid-sentence — the least
//      noticeable edit shape in a prose diff.
//   2. **The exemption inventory prints on success**, so growth from 0 to 40 is a visible CI
//      artifact rather than something you'd have to diff markdown by eye to notice.
// A marker on a link that DOES resolve also fails: an escape hatch that cannot detect its own
// obsolescence becomes permanent. A separate allowlist file was rejected — it drifts out of sync
// with the links it covers, the anti-pattern D3 already rejects for the digest triplication.
//
// KNOWN BOUNDARY (asserted by negative tests, not left to assumption): HTML `<a href>` is not
// checked, directories satisfy existence, and `#fragment` targets are not validated — only the file
// path before the fragment.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MARKER = '<!-- illustrative-path -->';
const MARKER_SCOPE = 'examples/';
// Inline link. `[^)\s]+` for the destination, optional `"title"`. Applied to fence-stripped content
// with the `s` flag absent — link text may span lines, so `[^\]]*` is allowed to match newlines.
const INLINE_RE = /\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+"[^"]*")?\s*\)/g;
// Reference-style usage `[text][ref]` (and collapsed `[ref][]`), plus the definition `[ref]: target`.
const REF_USE_RE = /\[([^\]]*)\]\[([^\]]*)\]/g;
const REF_DEF_RE = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*<?([^>\s]+)>?/gm;

function trackedMarkdown() {
  const out = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return out.split('\n').filter(Boolean).filter((f) => f !== 'CHANGELOG.md');
}

// Replace every fenced block and inline code span with equal-length blanks, preserving newlines and
// byte offsets so line numbers stay accurate. Blanking rather than deleting is what lets the caller
// keep using indexes into the original content.
function blankCode(src, file) {
  // Fences are handled with an explicit line-state pass, NOT a regex. A regex of the shape
  // /^```[\s\S]*?(^```$|$)/gm looks right and is not: with the `m` flag the `|$` fallback matches
  // end-of-LINE, so an unterminated-looking block collapses to its opening line and every link
  // below it is treated as prose. That bug is what let four fenced sample links read as real.
  const lines = src.split('\n');
  let inFence = false;
  let fenceChar = null;
  let fenceLen = 0;
  const blanked = lines.map((line) => {
    // Indent is `[ \t]*`, not `[ \t]{0,3}`. CommonMark caps a fence at 3 spaces relative to its
    // CONTAINING BLOCK — inside a list item that is the item's content column, so a fence indented
    // 4+ spaces is legal and common. Tracking list context to compute the relative cap is not worth
    // it here; accepting any indent means a 4-space *indented code block* is also skipped, which is
    // the safe direction. Be precise about the cost: it is not only displayed source. Two unrelated
    // stray fence-looking lines can pair up and silently swallow the real prose between them —
    // demonstrated, a planted dead link between two stray indented ``` lines is missed. Accepted
    // because the other direction is worse: flagging displayed source costs a broken illustration,
    // which is exactly what this iteration's Blocker did. Zero indented fences in the corpus today.
    const open = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (open) {
      const [char, len] = [open[1][0], open[1].length];
      if (!inFence) {
        inFence = true;
        fenceChar = char;
        fenceLen = len; // RUN LENGTH matters: CommonMark requires the closer be at least as long as
        // the opener, so a ``` inside a ```` block does NOT close it. Comparing only the character
        // let an inner example fence terminate its outer block, and everything between the inner
        // pair then read as prose.
        return ' '.repeat(line.length);
      }
      if (char === fenceChar && len >= fenceLen) {
        inFence = false;
        fenceChar = null;
        fenceLen = 0;
        return ' '.repeat(line.length);
      }
    }
    return inFence ? ' '.repeat(line.length) : line;
  });
  if (inFence) {
    // An unclosed fence blanks everything to EOF — safe (nothing is falsely flagged) but silent,
    // so links after it are never checked. Surfaced rather than swallowed.
    console.error(`check-links: WARNING unclosed code fence — links after it are unchecked`);
  }
  // Inline code spans, after fences so a backtick inside a fence can't confuse the pairing.
  return blanked.join('\n').replace(/`+[^`\n]*`+/g, (span) => span.replace(/[^\n]/g, ' '));
}

function isExternal(t) {
  return /^(https?:\/\/|mailto:)/i.test(t) || t.startsWith('#');
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function main() {
  const dead = [];
  const stale = [];
  const misplaced = [];
  let exemptions = 0;
  let checked = 0;

  for (const file of trackedMarkdown()) {
    const dir = path.dirname(file);
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      // A tracked file missing from the worktree is a real condition (mid-rebase, partial
      // checkout). Diagnose it rather than dying on an ENOENT stack.
      dead.push(`${file}: unreadable (${err.code || err.message})`);
      continue;
    }
    const src = blankCode(raw, file);

    // Reference definitions, harvested from the same blanked content so a definition inside a fence
    // is not honoured.
    const refs = new Map();
    REF_DEF_RE.lastIndex = 0;
    let d;
    while ((d = REF_DEF_RE.exec(src))) refs.set(d[1].toLowerCase(), d[2]);

    const found = [];
    INLINE_RE.lastIndex = 0;
    let m;
    while ((m = INLINE_RE.exec(src))) found.push({ target: m[1], index: m.index });
    REF_USE_RE.lastIndex = 0;
    while ((m = REF_USE_RE.exec(src))) {
      const key = (m[2] || m[1]).toLowerCase();
      if (refs.has(key)) found.push({ target: refs.get(key), index: m.index });
    }

    for (const { target: rawTarget, index } of found) {
      if (isExternal(rawTarget)) continue;
      const target = rawTarget.split('#')[0];
      if (target === '') continue;

      const lineStart = src.lastIndexOf('\n', index) + 1;
      const marked = src.slice(lineStart, index).trimEnd().endsWith(MARKER);
      const resolves = fs.existsSync(path.resolve(dir, target));
      const where = `${file}:${lineOf(src, index)} -> ${rawTarget}`;

      if (marked && !file.startsWith(MARKER_SCOPE)) {
        misplaced.push(where);
      } else if (!resolves && !marked) {
        dead.push(where);
      } else if (resolves && marked) {
        stale.push(where);
      } else if (marked) {
        exemptions++;
      } else {
        checked++;
      }
    }
  }

  let failed = false;
  if (dead.length) {
    console.error('DEAD RELATIVE LINK(S):');
    for (const x of dead) console.error(`  ${x}`);
    console.error(`\nIf a link is correct for the context an example illustrates but does not resolve\n` +
      `here, mark it inline on the SAME line, in ${MARKER_SCOPE}: ${MARKER}[text](path)`);
    failed = true;
  }
  if (stale.length) {
    console.error('STALE illustrative-path MARKER(S) — the target now resolves, drop the marker:');
    for (const x of stale) console.error(`  ${x}`);
    failed = true;
  }
  if (misplaced.length) {
    console.error(`illustrative-path MARKER OUTSIDE ${MARKER_SCOPE} — the hatch is scoped to examples:`);
    for (const x of misplaced) console.error(`  ${x}`);
    failed = true;
  }
  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-links: ${checked} relative link(s) resolve; ${exemptions} illustrative-path exemption(s)`
  );
}

main();
