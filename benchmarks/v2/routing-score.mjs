// routing-score.mjs: how well the deterministic router does on a labelled set. Macro-F1 weights rare routes equally, because a misroute
// is costly whichever route it hits. A request that goes to the coordinator to choose counts as covered when the right route is offered,
// and is reported on its own, because it costs one extra coordinator turn.

import { classify } from '../../scripts/lib/routes.mjs';

export function scoreRouter(items) {
  const labels = [...new Set(items.map((i) => i.route))].sort();
  const tally = Object.fromEntries(labels.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]));
  const wrong = [];
  let direct = 0;
  let choose = 0;
  let chooseCovered = 0;
  for (const item of items) {
    const r = classify({ request: item.text, ticket: item.ticket });
    if (r.via === 'choose') {
      choose++;
      if (r.choices.includes(item.route)) { chooseCovered++; tally[item.route].tp++; } else { tally[item.route].fn++; wrong.push({ text: item.text.slice(0, 70), want: item.route, got: r.choices.join('|') }); }
      continue;
    }
    if (r.route === item.route) { direct++; tally[item.route].tp++; continue; }
    tally[item.route].fn++;
    if (tally[r.route]) tally[r.route].fp++;
    wrong.push({ text: item.text.slice(0, 70), want: item.route, got: r.route });
  }
  const f1 = ({ tp, fp, fn }) => (tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn));
  const perRoute = Object.fromEntries(labels.map((l) => [l, +f1(tally[l]).toFixed(2)]));
  return {
    items: items.length, direct_correct: direct, sent_to_choose: choose, choose_covered: chooseCovered,
    wrong: wrong.length, accuracy: +((direct + chooseCovered) / items.length).toFixed(3),
    macro_f1: +(labels.reduce((s, l) => s + f1(tally[l]), 0) / labels.length).toFixed(3), per_route: perRoute, misses: wrong,
  };
}
