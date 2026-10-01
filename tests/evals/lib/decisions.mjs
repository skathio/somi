#!/usr/bin/env node
// Parses `.somi/plans/<slug>/decisions.md` so task 01's criteria can be EXECUTED rather than
// judged.
//
// WHY THIS EXISTS. Certification failed, and the failure had a shape: executed criteria scored
// 4/4, near-mechanical ones 4/4, and semantic judged ones 3/4, 3/4, 2/4. Asking a model judge for
// the >=99% consistency the error budget assumes is a category error, not a corpus defect that
// sharpening can fix — two rounds of sharpening moved nothing.
//
// The criteria were semantic because prose was all there was to score. `agents/planner.md` mandates
// a STRUCTURED `DECISIONS-NEEDED` block, but `commands/plan.md` relays it to the user, and in
// `--print` mode with no structured-question tool that relay is narrative prose. Measured: zero of
// four runs emitted the fenced block; `D1:` never appeared. The structure exists at the agent
// boundary and is destroyed by the presentation layer, and the eval was scoring the wreckage.
//
// `decisions.md` survives that. It is written to disk in `templates/DECISIONS.md.tmpl`'s shape, the
// harness already captures the working tree, and parsing it is deterministic.
//
// TOLERANT BY DESIGN. Every accessor returns what it found rather than throwing, and a caller that
// finds nothing must fall back rather than fail — a parser that returns `false` on an unanticipated
// heading level would fail correct runs for formatting, which is the "criterion that fails a
// conforming run" this corpus has rediscovered five times.

/**
 * Split a decisions.md into decision records.
 *
 * Headings are matched at `##` with a `D<n>` prefix, which is the template's shape. The `—` is
 * accepted as em dash, en dash or hyphen: the template uses an em dash and matching only that
 * would fail a run for a keystroke.
 */
export function parseDecisions(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const out = [];
  const re = /^##\s+(D\d+)\s*[—–-]\s*(.+?)\s*$/gm;
  const marks = [...text.matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    out.push({ id: marks[i][1], title: marks[i][2], body: text.slice(start, end) });
  }
  return out;
}

/**
 * A named `### ` section's body within one decision record.
 *
 * End anchor is `$(?![\s\S])`, NOT `\Z`. `\Z` is Python's end-of-input assertion; in JavaScript it
 * is an escaped `Z` that matches a literal letter. The last section in a record has no following
 * `###`, so with `\Z` it simply never matched and `options()` silently returned an empty list --
 * the second time this exact confusion has bitten in this repo (see lib/adr-shape.mjs).
 */
export function section(body, name) {
  const re = new RegExp(`^###\\s+${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=^###\\s|$(?![\\s\\S]))`, 'im');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

/** The `#### Option X — name` entries under "Alternatives considered", with their bullet fields. */
export function options(body) {
  const alts = section(body, 'Alternatives considered');
  if (!alts) return [];
  const marks = [...alts.matchAll(/^####\s+(.+?)\s*$/gm)];
  return marks.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : alts.length;
    const chunk = alts.slice(start, end);
    const field = (name) => {
      const f = chunk.match(new RegExp(`^\\s*[-*]\\s*\\*\\*${name}\\*\\*\\s*:?\\s*([\\s\\S]*?)(?=^\\s*[-*]\\s*\\*\\*|$(?![\\s\\S]))`, 'im'));
      return f ? f[1].trim() : null;
    };
    return {
      heading: m[1],
      chosen: /\bchosen\b/i.test(m[1]),
      pros: field('Pros'),
      cons: field('Cons'),
      reverses: field('Reverses'),
      rejection: field('Reason for rejection'),
    };
  });
}

/** Does any decision's title or Decision section concern the subject? Word-boundary matched. */
export function decisionAbout(decisions, terms) {
  const rx = new RegExp(`\\b(${terms.join('|')})`, 'i');
  return decisions.find((d) => rx.test(d.title) || rx.test(section(d.body, 'Decision') ?? '')) ?? null;
}

/** Every numeric magnitude in the text, for the over-production check. */
export function magnitudes(text) {
  const rx = /\b\d[\d,._]*\s*(?:rows|records|requests|events|req|rps|qps|[kmgt]i?b|[kmgt]\b|million|billion|thousand)\b/gi;
  return [...String(text ?? '').matchAll(rx)].map((m) => m[0].trim());
}
