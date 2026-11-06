#!/usr/bin/env node
// PreToolUse on file writes: changing which model a tier uses, or the quality gate's limits, is the maintainer's call, because lowering
// either lowers what a change is held to. Asks and does not deny, and it reads like any other permission question. An edit cannot show
// whether a limit goes up or down, so every change to one asks.

import { askPretool, readPayload, runHook, writeTargets } from '../lib/common.mjs';

const CONFIG = /(^|\/)(\.somi|somi)\/config\.json$/i;

runHook(() => {
  const payload = readPayload();
  const touchesConfig = writeTargets(payload).paths.some((t) => CONFIG.test(String(t).replaceAll('\\', '/')));
  if (!touchesConfig) return;
  const change = JSON.stringify(payload.tool_input ?? payload.toolArgs ?? {});
  if (/tiers|ceiling/.test(change)) askPretool(payload, 'This changes which models SoMi tiers use. Allow it?');
  else if (/quality/.test(change)) askPretool(payload, 'This changes the limits SoMi\'s quality gate holds code to. Allow it?');
});
