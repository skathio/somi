// usage.mjs: what a draw spent, read from its stream, and how close the host's own usage windows are to their limits.

import fs from 'node:fs';
import { HOST_STOP_SHARE } from './config.mjs';

// Result events come in runs within one CLI call, where usage is cumulative: the last of a run is the call's total.
/** The last usage the host reported in a stream, or null: { five_hour: {utilization, resetsAt}, seven_day: {...} }. */
export function hostWindows(file) {
  let found = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('rate_limit_info')) continue;
    try { found = JSON.parse(line).rate_limit_info?.unifiedWindows ?? found; } catch { /* a cut line says nothing */ }
  }
  return found;
}

/** Which of the host's windows is near its limit now: { name, resetsAt } or null. A window past its reset no longer counts. */
// The share each window may reach before a recording stops. The maintainer can raise them for one run, and they stay below 1.
export function hostStop(windows, nowMs = Date.now(), shares = { five_hour: HOST_STOP_SHARE, seven_day: HOST_STOP_SHARE }) {
  for (const name of ['seven_day', 'five_hour']) {
    const w = windows?.[name];
    if (w && w.utilization >= shares[name] && w.resetsAt * 1000 > nowMs) return { name, resetsAt: w.resetsAt, share: shares[name] };
  }
  return null;
}

// A resumed session's result reports cost and model usage for the whole session so far, while num_turns is that process's own. So the
// usage is the latest result of each session, added across sessions, and the turns add as before. A result with no session id counts
// on its own.
function addUsage(totals, spend, usages) {
  for (const [name, m] of usages.flatMap((u) => Object.entries(u))) {
    spend[name] = (spend[name] ?? 0) + (m?.costUSD ?? 0);
    totals.input += m?.inputTokens ?? 0;
    totals.output += m?.outputTokens ?? 0;
    totals.cacheRead += m?.cacheReadInputTokens ?? 0;
    totals.cacheCreation += m?.cacheCreationInputTokens ?? 0;
  }
}

const parseLine = (raw) => { try { return raw.trim() === '' ? null : JSON.parse(raw); } catch { return null; } };

export function streamUsage(file) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const spend = {};
  const models = new Set();
  let turns = 0;
  let compactions = 0;
  let pending = null;
  let anonymous = 0;
  const latest = new Map();
  const flush = () => { if (pending) latest.set(pending.key ?? `anonymous-${anonymous++}`, pending.usage); pending = null; };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { tokens: totals, models: [], turns, spend, compactions }; }
  for (const ev of text.split('\n').map(parseLine).filter(Boolean)) {
    if (ev.type === 'system' && ev.subtype === 'compact_boundary') compactions++;
    if (ev.type !== 'result') { flush(); continue; }
    turns += Number.isFinite(ev.num_turns) ? ev.num_turns : 0;
    if (!ev.modelUsage || typeof ev.modelUsage !== 'object') continue;
    pending = { key: typeof ev.session_id === 'string' ? ev.session_id : null, usage: ev.modelUsage };
    Object.keys(ev.modelUsage).forEach((m) => models.add(m));
  }
  flush();
  addUsage(totals, spend, [...latest.values()]);
  return { tokens: totals, models: [...models].sort(), turns, spend, compactions };
}

