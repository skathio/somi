// telemetry.mjs: what one draw did, as pure functions over its stream, transcripts and review record. A record carries these fields so
// nobody has to rebuild them from transcripts by hand. None of them enters the analysis as a covariate: passes and protocol
// adherence are effects of the arm, and adjusting for them would bias the comparison.

import { weightedTokens } from './stats.mjs';

const parseLines = (text) => String(text ?? '').split('\n').flatMap((line) => {
  if (line.trim() === '') return [];
  try { return [JSON.parse(line)]; } catch { return []; }
});

const STEP_TOOL = /somi_(route|review|note)$/;
const STEP_CLI = /\bsomi(?:\.mjs)?["']?\s+(route|review)\b/;
const ROUTE_TOOL = /somi_route$/;
const AGENT_TOOL = /^(?:Agent|Task)$/;

// The stream names who sent each message, but its usage figures are mid-stream placeholders. Transcripts hold the final figures for
// each message, so the split joins the two by message id. `coverage` is the share of the draw's total the join accounts for: a
// transcript too large to keep lowers it, and the report shows it rather than presenting a partial split as whole.
export function agentSplit(streamText, transcriptTexts, total) {
  const owner = new Map();
  const agentType = new Map();
  for (const ev of parseLines(streamText)) {
    if (ev?.type !== 'assistant' || !ev.message?.id) continue;
    for (const block of ev.message.content ?? []) {
      if (block?.type === 'tool_use' && AGENT_TOOL.test(block.name)) agentType.set(block.id, block.input?.subagent_type ?? 'general');
    }
    owner.set(ev.message.id, ev.parent_tool_use_id ? agentType.get(ev.parent_tool_use_id) ?? 'unknown' : 'main');
  }
  const final = new Map();
  for (const text of transcriptTexts) {
    for (const ev of parseLines(text)) {
      if (ev?.type === 'assistant' && ev.message?.id && ev.message.usage) final.set(ev.message.id, { usage: ev.message.usage, model: ev.message.model, side: ev.isSidechain === true });
    }
  }
  const agents = {};
  let accounted = 0;
  for (const [id, { usage, model, side }] of final) {
    const name = owner.get(id) ?? (side ? 'unknown' : 'main');
    const tokens = { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, cacheCreation: usage.cache_creation_input_tokens ?? 0 };
    const weighted = weightedTokens(tokens);
    agents[name] ??= { weighted: 0, messages: 0, models: [] };
    agents[name].weighted += weighted;
    agents[name].messages += 1;
    if (model && !agents[name].models.includes(model)) agents[name].models.push(model);
    accounted += weighted;
  }
  return { agents, coverage: total > 0 ? Math.min(1, accounted / total) : null };
}

// A draw that ends with a blocking finding still open has not delivered what a maintainer could ship.
export function reviewFacts(reviewsText) {
  const reviews = parseLines(reviewsText);
  const findings = {};
  for (const review of reviews) for (const f of review?.findings ?? []) findings[f.severity] = (findings[f.severity] ?? 0) + 1;
  const open = (reviews.at(-1)?.blocking ?? []).length > 0;
  return { passes: reviews.length, gates: open ? ['open-blocking'] : [], next: open ? 'ask' : null, stop: open ? 'open-blocking' : null, findings };
}

// The route an answer named, read from the tool's own result rather than from what the agent said about it.
function routedTo(events) {
  const ids = new Set();
  for (const ev of events) {
    for (const block of ev?.message?.content ?? []) {
      if (block?.type === 'tool_use' && ROUTE_TOOL.test(block.name)) ids.add(block.id);
      if (block?.type === 'tool_result' && ids.has(block.tool_use_id)) {
        const text = typeof block.content === 'string' ? block.content : block.content?.[0]?.text;
        try { const { route } = JSON.parse(text); if (route) return route; } catch { /* not an answer with a route */ }
      }
    }
  }
  return null;
}

export function adherence(streamText, reviewsText) {
  let tool = 0;
  let cli = 0;
  const agents = [];
  let inlineWrites = 0;
  const events = parseLines(streamText);
  for (const ev of events) {
    if (ev?.type !== 'assistant' || ev.parent_tool_use_id) continue;
    for (const block of ev.message?.content ?? []) {
      if (block?.type !== 'tool_use') continue;
      if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(block.name)) inlineWrites++;
      if (STEP_TOOL.test(block.name)) tool++;
      else if (block.name === 'Bash' && STEP_CLI.test(block.input?.command ?? '')) cli++;
      else if (AGENT_TOOL.test(block.name)) agents.push({ type: block.input?.subagent_type ?? 'general', model: block.input?.model ?? null });
    }
  }
  const route = tool > 0 && cli > 0 ? 'mixed' : tool > 0 ? 'tool' : cli > 0 ? 'cli' : 'none';
  return { route, steps: tool + cli, agents, inline_writes: inlineWrites, routed: routedTo(events), ...reviewFacts(reviewsText) };
}

// A stopped loop is not a solved task, whatever the tests say. A closing question after finished work is not a stop, so it needs the
// workspace to be unchanged before it counts as asking.
export function labelDraw({ outcome, reason, facts, paused, changed }) {
  if (outcome === 'invalid') return reason === 'timeout' ? { label: 'timed-out', gate: null } : { label: 'invalid', gate: null };
  if (outcome === 'over-budget') return { label: 'stopped-at-gate', gate: 'budget' };
  if (facts?.next === 'ask') return { label: 'stopped-at-gate', gate: facts.stop ?? 'ask' };
  if (outcome === 'paused' || (paused && !changed)) return { label: 'asked-user', gate: null };
  return { label: 'finished', gate: null };
}

const EXEMPT = ['.somi/', '.git/', '.claude/', 'node_modules/'];

// Comparing the manifests from before and after the draw. Changing an existing file outside what the task names breaks the task's
// "change only what it needs" and un-solves the draw. A new stray file is reported, because it breaks nothing it was told to keep.
export function scopeCheck(before, after, task) {
  const allowed = [...(task.source ?? []), task.test_dir ? `${task.test_dir}/` : null, ...(task.root_files ?? [])].filter(Boolean);
  const inScope = (p) => EXEMPT.some((e) => p.startsWith(e)) || allowed.some((a) => p === a || p.startsWith(a.endsWith('/') ? a : `${a}/`));
  const was = new Map(before.map(([p, ...rest]) => [p, JSON.stringify(rest)]));
  const now = new Map(after.map(([p, ...rest]) => [p, JSON.stringify(rest)]));
  const touched = [...was.keys()].filter((p) => !inScope(p) && now.get(p) !== was.get(p)).sort();
  const added = [...now.keys()].filter((p) => !inScope(p) && !was.has(p)).sort();
  return { touched, added };
}
