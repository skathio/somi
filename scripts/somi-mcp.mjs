#!/usr/bin/env node
// somi-mcp.mjs: a zero-dependency stdio MCP server with five tools. They give advice and keep a small record, and none of them holds up the
// conversation: a question, a follow-up or a change of mind never needs to go through here.
//
// MCP servers run outside the OS sandbox on Claude Code, so this path never executes project commands. It only reads git and SoMi's own files.
//
// Framing is newline-delimited JSON-RPC 2.0. Nothing but JSON-RPC reaches stdout; diagnostics go to stderr.

import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigFileError, loadConfig } from './lib/config-files.mjs';
import { advise, shardAdvice } from './lib/advisor.mjs';
import { repoRoot, stateIsTracked } from './lib/git-tree.mjs';
import { addToLedger } from './lib/ledger.mjs';
import { resolveProjectRoot } from './lib/mcp-project-root.mjs';
import { ReviewInputError } from './lib/policy.mjs';
import { closePlan, markMilestoneDone, planStatus, savePlan } from './lib/plan.mjs';
import { pullRequest } from './lib/pr.mjs';
import { readPrompt } from './lib/prompt.mjs';
import { recordReviews, reviewPlan } from './lib/reviews.mjs';
import { ShardError } from './lib/shards.mjs';
import { SECURITY_SIGNALS } from './lib/signals.mjs';
import { StateError } from './lib/state.mjs';
import { detectHost } from './lib/tiers.mjs';

const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2024-11-05', '2025-06-18']);
const LATEST_PROTOCOL_VERSION = '2025-06-18';
const ROOTS_TIMEOUT_MS = 2000;

function serverVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
  } catch { return 'unknown'; }
}

const write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const respond = (id, result) => write({ jsonrpc: '2.0', id, result });
const respondError = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

let nextId = 1;
let clientCapabilities = {};
const pending = new Map();

function requestFromClient(method, params) {
  const id = `srv-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`no answer to ${method}`)); }, ROOTS_TIMEOUT_MS);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    write({ jsonrpc: '2.0', id, method, params });
  });
}

async function listClientRoots() {
  if (!clientCapabilities?.roots) return undefined;
  const result = await requestFromClient('roots/list', {});
  return (Array.isArray(result?.roots) ? result.roots : []).map((r) => r?.uri).filter((u) => typeof u === 'string');
}

const PROJECT_DIR = { type: 'string', description: 'Absolute path of the project, when the host does not supply it.' };
const TOOLS = [
  {
    name: 'somi_route',
    description: 'Ask once when the user wants work done: a change, a bug, a plan, a review, a release or a ticket. Says which workflow and tier fit, and where to do it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        request: { type: 'string', description: 'The work: what the user wants, plus anything from the conversation it depends on, so that it reads on its own.' },
        hint: { type: 'string', description: 'A route name, when the user or an earlier answer named one.' },
        sensitive: { type: 'boolean', description: 'True only when the user has said this work is security-sensitive. Otherwise SoMi decides from the diff once the work is done.' },
        ticket: { type: 'object' },
        project_dir: PROJECT_DIR,
      },
    },
  },
  {
    name: 'somi_review',
    description: 'With no reviews, reads the diff and names the reviewers it needs. With reviews, records them and says what blocks the change.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviews: { type: 'array', items: { type: 'object' }, description: 'An array with every reviewer\'s JSON object, unchanged.' },
        tree: { type: 'string', description: 'The tree from the answer that listed the reviewers.' },
        always: { type: 'boolean', description: 'Review even if nothing in the diff calls for it.' },
        security: { type: 'boolean', description: 'Include the security reviewer even if nothing in the diff calls for it.' },
        base: { type: 'string', description: 'What to compare against, when it is not the default branch.' },
        project_dir: PROJECT_DIR,
      },
    },
  },
  {
    name: 'somi_note',
    description: 'Record a lasting decision or limit, so it survives compaction and reaches later workers.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['decision', 'constraint', 'pointer'] }, text: { type: 'string' }, project_dir: PROJECT_DIR },
      required: ['kind', 'text'],
    },
  },
  {
    name: 'somi_plan',
    description: 'The plan file for large work. text saves it, one "Milestone N: what it delivers" line each; done marks milestone N; close ends it; nothing shows progress.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, done: { type: 'integer', minimum: 1 }, close: { type: 'boolean' }, project_dir: PROJECT_DIR },
    },
  },
  {
    name: 'somi_pr',
    description: 'The pull request text for this branch. Refuses an unreviewed or blocked change unless unreviewed is true, and then says so at the top.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { unreviewed: { type: 'boolean', description: 'Only when the user has said to go ahead without the review.' }, base: { type: 'string' }, project_dir: PROJECT_DIR },
    },
  },
];

async function context(projectDir, env = process.env) {
  const resolved = await resolveProjectRoot({ projectDirArg: projectDir, listRoots: listClientRoots });
  if (!resolved.ok) throw new StateError(`${resolved.message}. Call again with project_dir set to your working directory.`);
  const root = repoRoot(resolved.root);
  if (!env.SOMI_STATE_DIR && stateIsTracked(root)) throw new StateError('.somi/state is committed to this repository, so SoMi will not trust it. Stop tracking it with `git rm -r --cached .somi/state`.');
  let layers = [];
  let config = {};
  try {
    const loaded = loadConfig(root, env);
    layers = [loaded.global.config, loaded.project.config];
    config = loaded.config;
  } catch (e) { if (!(e instanceof ConfigFileError)) throw e; }
  return { root, env, config, configLayers: layers, host: detectHost(env), now: () => env.SOMI_CLOCK || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

const textResult = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });

async function callTool(name, args) {
  const a = args !== null && typeof args === 'object' ? args : {};
  try {
    // Some hosts send what a model made up without checking it against the schema, and a field nobody reads would pass for a clean answer.
    const known = Object.keys(TOOLS.find((t) => t.name === name).inputSchema.properties);
    const unknown = Object.keys(a).filter((k) => !known.includes(k));
    if (unknown.length > 0) return textResult(`${name} has no field ${unknown.join(', ')}. It takes ${known.join(', ')}. Call it again with those.`, true);
    const ctx = await context(typeof a.project_dir === 'string' ? a.project_dir : undefined);
    // A model can call a tool before it has loaded the tool's fields. The user's own words were kept as they arrived, so they stand in.
    if (name === 'somi_route' && typeof a.request !== 'string' && typeof a.hint !== 'string') {
      const said = readPrompt(ctx.root, ctx.env);
      if (!said.trim()) return textResult('somi_route needs request set to the work. Call it again now, with request set to what the user asked for.', true);
      a.request = said;
    }
    switch (name) {
      case 'somi_route': return textResult(advise(ctx, { request: typeof a.request === 'string' ? a.request : undefined, hint: a.hint, ticket: a.ticket, sensitive: a.sensitive }));
      case 'somi_note': return textResult(addToLedger(ctx.root, { kind: a.kind, text: a.text }, ctx.env));
      case 'somi_plan': {
        if (a.close === true) return textResult(closePlan(ctx.root, ctx.env));
        if (Number.isInteger(a.done)) return textResult(markMilestoneDone(ctx.root, a.done));
        if (typeof a.text === 'string') return textResult({ saved: savePlan(ctx.root, a.text), ...planStatus(ctx.root) });
        return textResult(planStatus(ctx.root) ?? { plan: null, advice: 'No plan is open.' });
      }
      case 'somi_pr': {
        const result = pullRequest(ctx, { base: a.base, unreviewed: a.unreviewed === true });
        return textResult(result.ok ? { ...result, ...shardAdvice(ctx, 'pr.open') } : result, !result.ok);
      }
      default: {
        const options = { base: a.base, always: a.always === true, security: a.security === true };
        // A model may send the array as text. The content is what matters, and it is validated either way.
        if (typeof a.reviews === 'string') { try { a.reviews = JSON.parse(a.reviews); } catch { return textResult('reviews is not valid JSON. Send an array with every reviewer\'s JSON object.', true); } }
        if (!a.reviews) {
          const plan = reviewPlan(ctx, options);
          return textResult({ ...plan, ...(plan.signals.some((s) => SECURITY_SIGNALS.includes(s)) ? { security: 'Security signals fired on this diff, so the review and any fix stay on this conversation\'s model.' } : {}), advice: plan.covered ? 'An earlier review still covers this change, and nothing since calls for another. Do not run the reviewers again. Carry on.' : plan.needed ? 'Start each listed reviewer as a fresh agent on its model, in the foreground, with its brief unchanged and nothing added. Start them together if the host allows it. Then call somi_review with reviews set to an array of every reviewer\'s JSON unchanged, and tree set to the tree above.' : 'No review is needed for this change. Carry on.' });
        }
        return textResult({ ...recordReviews(ctx, { ...options, reviews: a.reviews, tree: a.tree }), ...shardAdvice(ctx, 'review.done') });
      }
    }
  } catch (e) {
    const expected = e instanceof ReviewInputError || e instanceof StateError || e instanceof ShardError;
    if (!expected) process.stderr.write(`somi-mcp: ${e.stack ?? e}\n`);
    return textResult(expected ? e.message : `${name} failed; see the server log`, true);
  }
}

async function handleRequest(id, method, params) {
  switch (method) {
    case 'initialize':
      clientCapabilities = params?.capabilities && typeof params.capabilities === 'object' ? params.capabilities : {};
      respond(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'somi', version: serverVersion() },
      });
      return;
    case 'ping': respond(id, {}); return;
    case 'tools/list': respond(id, { tools: TOOLS }); return;
    case 'tools/call':
      if (!TOOLS.some((t) => t.name === params?.name)) { respondError(id, -32602, `Unknown tool: ${params?.name}`); return; }
      respond(id, await callTool(params.name, params.arguments));
      return;
    default: respondError(id, -32601, `Method not found: ${method}`);
  }
}

function handleMessage(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) { respondError(null, -32600, 'Invalid Request'); return; }
  if (msg.method === undefined) {
    const waiting = pending.get(msg.id);
    if (waiting) {
      pending.delete(msg.id);
      if (msg.error) waiting.reject(new Error(msg.error.message)); else waiting.resolve(msg.result);
    }
    return;
  }
  if (msg.id === undefined) return;
  handleRequest(msg.id, msg.method, msg.params).catch((e) => {
    process.stderr.write(`somi-mcp: ${e.stack ?? e}\n`);
    respondError(msg.id, -32603, 'Internal error');
  });
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { respondError(null, -32700, 'Parse error'); return; }
  handleMessage(msg);
});
rl.on('close', () => process.exit(0));
