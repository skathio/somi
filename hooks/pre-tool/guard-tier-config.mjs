#!/usr/bin/env node
// PreToolUse on file writes: changing which model a tier uses is the maintainer's call, because lowering one lowers what a review can
// see. Asks and does not deny, and it reads like any other permission question.

import { askPretool, readPayload, runHook, writeTargets } from '../lib/common.mjs';

const CONFIG = /(^|\/)(\.somi|somi)\/config\.json$/i;

runHook(() => {
  const payload = readPayload();
  const touchesConfig = writeTargets(payload).paths.some((t) => CONFIG.test(String(t).replaceAll('\\', '/')));
  if (!touchesConfig) return;
  const change = JSON.stringify(payload.tool_input ?? payload.toolArgs ?? {});
  if (/tiers|ceiling/.test(change)) askPretool(payload, 'This changes which models SoMi tiers use. Allow it?');
});
