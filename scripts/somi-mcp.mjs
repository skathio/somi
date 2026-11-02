#!/usr/bin/env node
// somi-mcp.mjs: a zero-dependency stdio MCP server with one tool, somi_step. It moves the state machine and reports status, and it
// returns no procedure text.
//
// MCP servers run outside the OS sandbox on Claude Code, so this path never executes project commands. It reads git and the journal.
// `somi check` must have run in the sandboxed shell first; otherwise after-code refuses with `check-required`.
//
// Framing is newline-delimited JSON-RPC 2.0. Nothing but JSON-RPC reaches stdout; diagnostics go to stderr.

import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigFileError, loadConfig } from './lib/config-files.mjs';
import { repoRoot, stateIsTracked } from './lib/git-tree.mjs';
import { StateError } from './lib/journal.mjs';
import { ShardError } from './lib/shards.mjs';
import { abandon, closeMilestone, decide, done, resume, reviewed, route } from './lib/engine.mjs';
import { TransitionError, afterCode, open, status } from './lib/kernel.mjs';
import { addToLedger } from './lib/ledger.mjs';
import { expertiseIndex } from './lib/workflows.mjs';
import { resolveProjectRoot } from './lib/mcp-project-root.mjs';
import { ReviewInputError } from './lib/policy.mjs';
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

const TOOL = {
  name: 'somi_step',
  description: 'SoMi\'s step engine. Pass a request to action "route"; every answer names the next action and how to carry it out.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['route', 'done', 'after-review', 'decide', 'close', 'status', 'resume', 'abandon', 'ledger', 'expertise', 'open', 'after-code'] },
      request: { type: 'string' },
      project_dir: { type: 'string', description: 'Absolute path of the project, when the host does not supply it.' },
      ticket: { type: 'object' },
      hint: { type: 'string' },
      status: { type: 'string', enum: ['ok', 'too-big', 'blocked'] },
      summary: { type: 'string' },
      milestones: { type: 'array', items: { type: 'string' } },
      keep: { type: 'array', items: { type: 'string' } },
      kind: { type: 'string', enum: ['decision', 'constraint', 'pointer'] },
      title: { type: 'string' },
      ask: { type: 'string' },
      follow_up: { type: 'string' },
      release_candidate: { type: 'boolean' },
      reviews: { type: 'array', items: { type: 'object' } },
      text: { type: 'string' },
      then: { type: 'string', enum: ['continue', 'close', 'abort'] },
    },
    required: ['action'],
  },
};

async function context(projectDir, env = process.env) {
  const resolved = await resolveProjectRoot({ projectDirArg: projectDir, listRoots: listClientRoots });
  if (!resolved.ok) throw new TransitionError(`${resolved.message}. Call again with project_dir set to your working directory.`);
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

async function callStep(args) {
  const a = args !== null && typeof args === 'object' ? args : {};
  try {
    const ctx = await context(typeof a.project_dir === 'string' ? a.project_dir : undefined);
    switch (a.action) {
      case 'open': return textResult(open(ctx, { title: a.title, ask: a.ask, followUp: a.follow_up, releaseCandidate: a.release_candidate === true }));
      case 'after-code': return textResult(afterCode(ctx));
      case 'route': return textResult(route(ctx, { request: a.request, ticket: a.ticket, hint: a.hint }));
      case 'done': return textResult(done(ctx, { status: a.status, summary: a.summary, milestones: a.milestones, keep: a.keep }));
      case 'resume': return textResult(resume(ctx));
      case 'abandon': return textResult(abandon(ctx));
      case 'ledger': return textResult(addToLedger(ctx.root, { kind: a.kind, text: a.text }, ctx.env));
      case 'expertise': return textResult(expertiseIndex());
      case 'after-review': return textResult(reviewed(ctx, { reviews: a.reviews }));
      case 'decide': return textResult(decide(ctx, { text: a.text, then: a.then }));
      case 'close': return textResult(closeMilestone(ctx));
      case 'status': return textResult(status(ctx));
      default: return textResult('action must be route, done, after-review, decide, close, status, resume, abandon, ledger, expertise, open or after-code', true);
    }
  } catch (e) {
    const expected = e instanceof TransitionError || e instanceof ReviewInputError || e instanceof StateError || e instanceof ShardError;
    if (!expected) process.stderr.write(`somi-mcp: ${e.stack ?? e}\n`);
    return textResult(expected ? e.message : 'somi_step failed; see the server log', true);
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
    case 'tools/list': respond(id, { tools: [TOOL] }); return;
    case 'tools/call':
      if (params?.name !== TOOL.name) { respondError(id, -32602, `Unknown tool: ${params?.name}`); return; }
      respond(id, await callStep(params.arguments));
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
