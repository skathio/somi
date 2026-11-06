// pr.mjs: the pull request text and the gate in front of it, the same from the CLI and from the MCP tool. Building it only reads git and
// SoMi's own files, so it is safe outside the sandbox.

import fs from 'node:fs';
import { commitSubjects, snapshotTree } from './git-tree.mjs';
import { readLedger } from './ledger.mjs';
import { readMigrated } from './migrate.mjs';
import { prGate, readReviews } from './reviews.mjs';
import { statePaths } from './state.mjs';
import { renderPr } from './views.mjs';

export const lastCheck = (root, env) => { try { return JSON.parse(fs.readFileSync(statePaths(root, env).check, 'utf8')); } catch { return null; } };
export const migratedFindings = (root, env) => readMigrated(root, env).flatMap((m) => m.findings ?? []);

// {ok, text} or {ok: false, why}. Going ahead unreviewed is the user's call, and the text then says so at the top.
export function pullRequest(ctx, { base, unreviewed = false } = {}) {
  const gate = prGate(ctx, { base });
  if (!gate.ok && !unreviewed) {
    const why = gate.reason === 'open-blocking' ? 'blocking findings are still open on this change' : `this change needs a review and none covers it (${gate.signals.join(', ')})`;
    return { ok: false, reason: gate.reason, why: `No pull request text, because ${why}. Run a review and record it. To go ahead anyway, pass unreviewed, and the text will say so at the top.` };
  }
  const text = renderPr({ subjects: commitSubjects(ctx.root, gate.plan.base), gate, ledger: readLedger(ctx.root, ctx.env), reviews: readReviews(ctx.root, ctx.env), check: lastCheck(ctx.root, ctx.env), tree: snapshotTree(ctx.root), migrated: migratedFindings(ctx.root, ctx.env) });
  return { ok: true, reviewed: gate.ok, text };
}
