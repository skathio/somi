// loop-dispatch.mjs -- the dispatch record of a loop: for every agent a loop starts, what SoMi resolved for it
// (tier, model, whether the model was enforced, the host, why not). Shared by scripts/somi-loop.mjs.
//
// The entry is computed here from the same resolver somi_resolve uses (read-only, nothing persisted), never
// copied from the orchestrator's arguments, so it cannot claim a tier or model the resolver did not give. It
// records the decision SoMi made; which model the host then actually ran is not visible to a plugin, and the
// `enforced: false` entries are exactly the ones where the host's own choice applied.

import { resolveDispatch } from './dispatch-resolver.mjs';

// -> { ok: true, entry } | { ok: false, code, message }
export function dispatchEntry({ root, installRoot, agent, host, pass }) {
  const r = resolveDispatch({ agent, host, projectRoot: root, installRoot, persist: false });
  if (!r.ok) return r;
  const x = r.result;
  const entry = { pass, agent: x.agent, host: host || 'claude-code', tier: x.tier, degraded: x.degraded, model: x.model, enforced: x.enforced, ceiling: x.ceiling };
  if (x.reason) entry.reason = x.reason;
  return { ok: true, entry };
}
