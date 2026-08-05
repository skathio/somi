#!/usr/bin/env node
// Parses the fenced `decisions-needed` block from a run's output.
//
// This is the third target tried for task 01's criteria, and the reasoning for each move matters
// more than the code:
//
//   1. THE PROSE RELAY -- semantic, so every criterion had to be judged, and judged semantic
//      criteria measured 2/4 to 3/4 against a bar of >=99%. A model judge cannot be that
//      consistent; sharpening the wording twice moved nothing because wording was not the problem.
//   2. decisions.md -- structured, but EMPTY in the pass this task scores. The research pass halts
//      before anything is verified, so the file is a scaffold. Parsing it read `<decision title in
//      noun form>` as content and manufactured failures.
//   3. THE FENCE -- the planner's own structured block, relayed verbatim. It exists at the agent
//      boundary in every run; it was simply being flattened before anyone could read it.
//
// The fence is emitted by `commands/plan.md` alongside the human-readable relay, so the human
// keeps prose and every other consumer gets structure.

/** The block's raw text, or null when the run emitted no fence. */
export function extractBlock(text) {
  const m = String(text ?? '').match(/```decisions-needed\s*\n([\s\S]*?)```/);
  return m ? m[1] : null;
}

/**
 * Parse `D<n>:` records and their `Option X —` entries.
 *
 * Indentation-based, matching the block's documented shape, and tolerant of the field being
 * absent — a missing `Reverses:` is a finding, not a parse error.
 */
export function parseBlock(text) {
  const raw = extractBlock(text);
  if (raw === null) return null;                       // no fence: caller must fall back
  const decisions = [];
  const lines = raw.split('\n');
  let cur = null;
  let opt = null;
  const field = (l, name) => {
    const m = l.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'i'));
    return m ? m[1].trim() : null;
  };
  for (const l of lines) {
    const d = l.match(/^\s*(D\d+):\s*(.*)$/);
    if (d) { cur = { id: d[1], title: d[2].trim(), decides: null, options: [] }; decisions.push(cur); opt = null; continue; }
    if (!cur) continue;
    const dec = field(l, 'Decides');
    if (dec !== null) { cur.decides = dec; continue; }
    const o = l.match(/^\s*Option\s+([A-Z])\s*[—–-]\s*(.*)$/);
    if (o) {
      opt = { letter: o[1], name: o[2].replace(/—\s*RECOMMENDED.*$/i, '').trim(), recommended: /RECOMMENDED/i.test(o[2]), pros: null, cons: null, reverses: null };
      cur.options.push(opt);
      continue;
    }
    if (!opt) continue;
    for (const f of ['Pros', 'Cons', 'Reverses']) {
      const v = field(l, f);
      if (v !== null) opt[f.toLowerCase()] = v;
    }
  }
  return decisions;
}

/** Find a decision whose title or `Decides:` names the subject. */
export function decisionAbout(decisions, terms) {
  const rx = new RegExp(`\\b(${terms.join('|')})`, 'i');
  return (decisions ?? []).find((d) => rx.test(d.title) || rx.test(d.decides ?? '')) ?? null;
}
