#!/usr/bin/env node
// somi-mcp.mjs — a zero-dependency stdio MCP server bundling scripts/lib/dispatch-resolver.mjs's
// resolveDispatch() as the `somi_resolve` tool, plus a command-procedure text reader as the
// `somi_command` tool, a skill-text reader as the `somi_skill` tool and an agent-instructions
// reader as the `somi_agent` tool. Both Claude Code and
// Copilot CLI launch a plugin's bundled MCP server with its root already expanded
// (${CLAUDE_PLUGIN_ROOT} / ${PLUGIN_ROOT}), so a prompt calling these tools never needs to know
// where SoMi is installed — unlike scripts/somi-dispatch.mjs, which a prompt can only shell out to
// via a path it has to already know. That CLI stays the other consumer of the identical
// resolveDispatch() — this file's test harness and the fallback for a host with a shell but no
// MCP. Neither surface re-derives the composition or validation order. `somi_skill` exists for the
// identical reason `somi_command` does: a skill reference that's a relative link into SoMi's own
// install directory can't be followed from a consuming project, so its text is served over the
// same stdio channel instead.
//
// Hand-rolled, on purpose (zero dependencies — no MCP SDK): newline-delimited JSON-RPC 2.0 over
// stdio, one JSON object per line either direction, matching the MCP stdio transport's own framing
// rule. Nothing but JSON-RPC ever reaches stdout; every diagnostic goes to stderr, so a stray
// future console.log can never corrupt the wire format.
//
// Methods handled: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`.
// Anything else is a JSON-RPC method-not-found when it arrived as a request (has an `id`); an
// unrecognized NOTIFICATION (no `id`) is logged to stderr and dropped. Malformed JSON gets a parse
// error with `id: null` — the server keeps running; one bad line must never kill in-flight calls.

import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDispatch,
  validateDispatchArgs,
  AGENT_NAME_RE,
  EXIT_USAGE,
  EXIT_UNKNOWN_AGENT,
} from './lib/dispatch-resolver.mjs';
import { resolveProjectRoot } from './lib/mcp-project-root.mjs';
import { SIGNAL_IDS } from './lib/size-tier.mjs';

const PROG = 'somi-dispatch'; // shared identity with the CLI: this is the SAME resolver speaking.

// A small allowlist, not an echo of whatever `protocolVersion` the client sent -- that would be a
// promise this server never checked it can keep. `LATEST_PROTOCOL_VERSION` is the fallback.
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2024-11-05', '2025-06-18']);
const LATEST_PROTOCOL_VERSION = '2025-06-18';

function installRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function serverVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(installRoot(), 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function log(msg) {
  process.stderr.write(`somi-mcp: ${msg}\n`);
}

// --- JSON-RPC framing ----------------------------------------------------------------------

let nextOutgoingId = 1;
const pendingOutgoing = new Map(); // id -> {resolve, reject}
let clientCapabilities = {};

function writeMessage(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function respond(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

// Sends a request FROM this server TO the client (e.g. `roots/list`) and returns a promise for
// its result. Timed out rather than left to hang forever — a client that never declared (or
// never actually implements) `roots` would otherwise stall somi_resolve indefinitely.
function requestFromClient(method, params, timeoutMs = 2000) {
  const id = `srv-${nextOutgoingId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingOutgoing.delete(id);
      reject(new Error(`timed out waiting for the client's response to ${method}`));
    }, timeoutMs);
    pendingOutgoing.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    writeMessage({ jsonrpc: '2.0', id, method, params });
  });
}

// Returns the RAW `uri` strings from the client's roots/list answer, unfiltered and undecoded —
// mcp-project-root.mjs owns deciding what counts as a usable root, so that logic lives in one
// place. Returns undefined when the client never declared `roots` at initialize, so its host-root
// lookup contributes nothing rather than attempting a round trip that was never going to answer.
async function listClientRoots() {
  if (!clientCapabilities || !clientCapabilities.roots) return undefined;
  const result = await requestFromClient('roots/list', {});
  const roots = Array.isArray(result?.roots) ? result.roots : [];
  return roots.map((r) => (typeof r?.uri === 'string' ? r.uri : null)).filter((u) => u !== null);
}

// --- tool definitions ------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'somi_resolve',
    description:
      "Resolve one agent's dispatch tier and model: its cost.agents override from .somi/config.json, " +
      'else the current session ceiling itself (a hard cap) — the ' +
      'MCP-native equivalent of `node scripts/somi-dispatch.mjs resolve`. Same validation, same ' +
      'four-code failure family (64 usage / 65 unknown agent / 66 malformed cost: declaration / ' +
      '67 project environment failure — including "no project root could be established": no ' +
      'CLAUDE_PROJECT_DIR, no usable MCP roots, and no project_dir given), reported in the tool ' +
      'result text on failure.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'agent name, e.g. "coder" (matches ^[a-z][a-z0-9-]*$)' },
        host: { type: 'string', description: 'e.g. "claude-code" or "copilot"; defaults to "claude-code"' },
        ceiling: {
          type: 'string',
          description:
            'one of low|medium|high. Used for this call and remembered as an explicitly set ' +
            'value, but cost.ceiling in .somi/config.json is read live and outranks it, so it ' +
            'does not last where the config sets one — omit it unless the user actually asked ' +
            'to change the ceiling.',
        },
        project_dir: {
          type: 'string',
          description:
            'absolute path to the CONSUMING project (where .somi/ lives). Only needed when ' +
            'CLAUDE_PROJECT_DIR is unset and the client offers no MCP roots. When the host DOES ' +
            'supply a root, this must be that root or a directory inside it — narrows it, never ' +
            'overrides it; an outside value is refused (64), nothing read or written.',
        },
      },
      required: ['agent'],
    },
  },
  {
    name: 'somi_command',
    description:
      "Read a SoMi command's own procedure text (commands/<name>.md) from the install root, so " +
      'a front door running in a consuming project can follow it live without knowing where SoMi ' +
      'is installed.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'command name, e.g. "plan" (matches ^[a-z][a-z0-9-]*$)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'somi_skill',
    description:
      "Read a SoMi skill's own text (skills/<name>/SKILL.md) from the install root — the same " +
      'problem `somi_command` solves for commands/, applied to skills/: a reference to a skill from ' +
      "a consuming project can't rely on a relative link into SoMi's own install directory, since " +
      "that directory generally isn't the consuming project's own tree. Read the dispatch " +
      'procedure this way (`somi_skill({name: "somi-dispatch"})`) whenever the skill can\'t be ' +
      'loaded by name on the current host (e.g. no Skill tool, or a non-Claude-Code host).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill name, e.g. "somi-dispatch" (matches ^[a-z][a-z0-9-]*$)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'somi_agent',
    description:
      "Read a SoMi agent's instructions (agents/<name>.md, frontmatter removed) from the install " +
      "root. For a host whose subagent tool cannot start a plugin agent by name (Copilot's task " +
      'tool accepts only its built-in types): start a built-in general-purpose subagent with this ' +
      'text as the start of its prompt, and the model somi_resolve returned.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'agent name, e.g. "reviewer" (matches ^[a-z][a-z0-9-]*$)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'somi_config',
    description:
      'Show or change the cost settings in the project\'s .somi/config.json by running ' +
      '`node scripts/somi-config.mjs`, and return its one JSON line unchanged. Actions: show ' +
      '(every agent\'s effective tier and warnings), get, set, unset, init (create the default file ' +
      'when absent). Only cost.ceiling and cost.agents.<name> can be changed, to low|medium|high; ' +
      'the change is live, since the config is read on every dispatch. Failures report the CLI exit ' +
      'code: 64 usage (bad key, tier or name), 67 the project\'s config or .somi is unusable.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'show, get, set, unset or init' },
        key: { type: 'string', description: 'cost.ceiling or cost.agents.<name> (get, set, unset)' },
        value: { type: 'string', description: 'low, medium or high (set)' },
        project_dir: { type: 'string', description: 'absolute path of the project, as for somi_resolve' },
      },
      required: ['action'],
    },
  },
  {
    name: 'somi_tier',
    description:
      "Size a request: run `node scripts/somi-tier.mjs resolve` (no --record) on the signals you " +
      'extracted and return its one JSON line unchanged (tier, effective, source, floor, reasons, ' +
      'basis). The rubric is the skill somi-routing, section Size tiers; this tool states no ' +
      'thresholds. The signal ids in `signals` are exact: use these names and no others. A name that ' +
      'is not one is ignored and listed back as `unrecognized` next to `expected`, and a missing ' +
      'signal is read as its worst case. Failures report the CLI exit code: 64 usage/input, 65 refused (a downward ' +
      'override below the security floor). It writes nothing: the tier record and the approval ' +
      'stamp need the CLI itself with --record and approve. SoMi is installed at ' + installRoot() +
      ': run `node <that path>/scripts/somi-tier.mjs ...` from the project directory.',
    inputSchema: {
      type: 'object',
      properties: {
        signals: {
          type: 'object',
          description: 'One entry per rubric signal id, with exactly these names: { value, evidence }. What each means and how to extract it is in the skill somi-routing, section Size tiers.',
          properties: Object.fromEntries(SIGNAL_IDS.map((id) => [id, {
            type: 'object',
            properties: { value: { description: 'true or false, or a whole number for a count signal; null when it cannot be determined' }, evidence: { type: 'string', description: 'files and lines you opened' } },
            required: ['value', 'evidence'],
          }])),
          required: [...SIGNAL_IDS],
        },
        override: { type: 'string', description: 'small or full; only after a human reply' },
      },
      required: ['signals'],
    },
  },
];

// --- tool implementations --------------------------------------------------------------------

function textResult(text, isError = false) {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

async function callSomiResolve(args) {
  // Validated BEFORE the project-root lookup below (can be a 2s roots/list round trip). Raw args
  // pass through unmodified -- validateDispatchArgs distinguishes "not given" (undefined) from
  // "given but the wrong shape" (an array, an object, ''); silently coercing a wrong-shaped value
  // to '' here, as an earlier version did, is exactly what let a bad host/ceiling default silently.
  const validated = validateDispatchArgs({ agent: args?.agent, host: args?.host, ceiling: args?.ceiling });
  if (!validated.ok) {
    return textResult(`${PROG}: ${validated.message} (exit ${validated.code})`, true);
  }

  // project_dir passes through RAW too -- resolveProjectRoot's own validateDir() turns "not a
  // string" into a clean 64, rather than this function quietly treating it as "not given".
  const rootOutcome = await resolveProjectRoot({
    projectDirArg: args?.project_dir,
    listRoots: () => listClientRoots(),
  });
  if (!rootOutcome.ok) {
    return textResult(`${PROG}: ${rootOutcome.message} (exit ${rootOutcome.code})`, true);
  }

  // agent/host/ceiling are already validated above; resolveDispatch re-runs the same cheap check.
  const outcome = resolveDispatch({
    agent: args.agent,
    host: args.host,
    ceiling: args.ceiling,
    projectRoot: rootOutcome.root,
    installRoot: installRoot(),
  });

  if (!outcome.ok) {
    return textResult(`${PROG}: ${outcome.message} (exit ${outcome.code})`, true);
  }
  return textResult(JSON.stringify(outcome.result));
}

// One reader for every install-root text tool. The name is checked against AGENT_NAME_RE BEFORE
// any path is built, so a traversal payload (`../x`, `a/b`) is a 64 and never reaches path.join.
// JSON.stringify, not a template interpolation, for the invalid name: an object-shaped `name`
// (e.g. `{toString: null}`) throws inside `${name}` and would surface as an unrelated -32603.
function readInstallText(prog, kind, name, relPath) {
  if (typeof name !== 'string' || !AGENT_NAME_RE.test(name)) {
    return { error: textResult(`${prog}: invalid name ${JSON.stringify(name)} (expected ${AGENT_NAME_RE}) (exit ${EXIT_USAGE})`, true) };
  }
  const filePath = path.join(installRoot(), ...relPath(name));
  try {
    return { content: fs.readFileSync(filePath, 'utf8') };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { error: textResult(`${prog}: unknown ${kind} "${name}" (no ${filePath}) (exit ${EXIT_UNKNOWN_AGENT})`, true) };
    }
    throw e;
  }
}

function callSomiCommand(args) {
  const r = readInstallText('somi-command', 'command', args?.name, (n) => ['commands', `${n}.md`]);
  return r.error ?? textResult(r.content);
}

function callSomiSkill(args) {
  const r = readInstallText('somi-skill', 'skill', args?.name, (n) => ['skills', n, 'SKILL.md']);
  return r.error ?? textResult(r.content);
}

// The agent's instructions without its frontmatter: a host that cannot start a plugin agent by
// type (Copilot's task tool) starts a built-in general-purpose subagent with this text instead, and
// the frontmatter's `model:` would contradict the tier somi_resolve just selected.
function callSomiAgent(args) {
  const r = readInstallText('somi-agent', 'agent', args?.name, (n) => ['agents', `${n}.md`]);
  return r.error ?? textResult(r.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trimStart());
}

// Runs the sizing CLI itself, so the result and the exit codes are the CLI's, byte for byte.
function callSomiTier(args) {
  if (args.signals === null || typeof args.signals !== 'object' || Array.isArray(args.signals)) {
    return textResult('somi-tier: signals must be an object (exit 64)', true);
  }
  const argv = [path.join(installRoot(), 'scripts', 'somi-tier.mjs'), 'resolve', '--signals', '-'];
  if (args.override !== undefined) argv.push('--override', String(args.override));
  const r = spawnSync(process.execPath, argv, { input: JSON.stringify(args.signals), encoding: 'utf8', timeout: 10000 });
  if (r.status === 0) return textResult(r.stdout.trimEnd());
  return textResult(`${(r.stderr || 'somi-tier: failed').trim()} (exit ${r.status ?? 'none'})`, true);
}

// Runs the config CLI itself (never a shell), so output and exit codes are the CLI's, byte for byte.
async function callSomiConfig(args) {
  const text = (v) => v === undefined || typeof v === 'string';
  if (typeof args.action !== 'string' || !['show', 'get', 'set', 'unset', 'init'].includes(args.action)) {
    return textResult('somi-config: action must be one of show, get, set, unset, init (exit 64)', true);
  }
  if (!text(args.key) || !text(args.value) || [args.key, args.value].some((v) => v !== undefined && (v === '' || v.startsWith('-') || /[\u0000-\u001f\u007f]/.test(v)))) {
    return textResult('somi-config: key and value must be non-empty strings without control characters that do not start with a dash (exit 64)', true);
  }
  // Writes need a root the HOST supplied: a model-supplied project_dir alone could point a write anywhere.
  // The probe (no project_dir) succeeds, or fails as ambiguous, only when the host offered a root.
  if (args.action !== 'show' && args.action !== 'get') {
    const probe = await resolveProjectRoot({ projectDirArg: undefined, listRoots: () => listClientRoots() });
    if (!probe.ok && !probe.message.startsWith('ambiguous')) {
      return textResult('somi-config: no host project root; run the CLI yourself (node scripts/somi-config.mjs) to change the config (exit 67)', true);
    }
  }
  const rootOutcome = await resolveProjectRoot({ projectDirArg: args.project_dir, listRoots: () => listClientRoots() });
  if (!rootOutcome.ok) return textResult(`somi-config: ${rootOutcome.message} (exit ${rootOutcome.code})`, true);
  const argv = [path.join(installRoot(), 'scripts', 'somi-config.mjs'), args.action];
  if (args.key !== undefined) argv.push(args.key);
  if (args.value !== undefined) argv.push(args.value);
  // Lowering a tier needs the user. Where the SoMi plugin's hooks run (CLAUDE_PLUGIN_ROOT is set in this
  // server's environment) the cost-lowering PreToolUse hook asks the user; where it is not, nothing can
  // ask, so the CLI refuses a lowering. This is a heuristic for "a hook can ask", not a guarantee.
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if ((args.action === 'set' || args.action === 'unset') && !(pluginRoot && !pluginRoot.includes('${'))) argv.push('--refuse-lowering');
  argv.push('--project-dir', fs.realpathSync(rootOutcome.root));
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 10000 });
  if (r.status === 0) return textResult(r.stdout.trimEnd());
  return textResult(`${(r.stderr || 'somi-config: failed').trim()} (exit ${r.status ?? 'none'})`, true);
}

// Returns null for an unrecognized tool name — the caller turns that into a JSON-RPC error, since
// an unknown TOOL is the protocol failing to find it at all, distinct from a known tool that ran
// and failed (which reports isError:true in an otherwise-successful JSON-RPC response).
async function callTool(name, args) {
  switch (name) {
    case 'somi_resolve': return await callSomiResolve(args || {});
    case 'somi_command': return callSomiCommand(args || {});
    case 'somi_skill': return callSomiSkill(args || {});
    case 'somi_agent': return callSomiAgent(args || {});
    case 'somi_tier': return callSomiTier(args || {});
    case 'somi_config': return await callSomiConfig(args || {});
    default: return null;
  }
}

// --- JSON-RPC method dispatch -----------------------------------------------------------------

async function handleRequest(id, method, params) {
  switch (method) {
    case 'initialize': {
      clientCapabilities = params?.capabilities && typeof params.capabilities === 'object' ? params.capabilities : {};
      // A version this server actually supports, never an echo of the client's request.
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      respond(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'somi', version: serverVersion() },
      });
      return;
    }
    case 'ping':
      respond(id, {});
      return;
    case 'tools/list':
      respond(id, { tools: TOOLS });
      return;
    case 'tools/call': {
      const toolName = params?.name;
      const result = await callTool(toolName, params?.arguments);
      if (result === null) {
        respondError(id, -32602, `Unknown tool: ${toolName}`);
        return;
      }
      respond(id, result);
      return;
    }
    default:
      respondError(id, -32601, `Method not found: ${method}`);
  }
}

function handleNotification(method) {
  if (method === 'notifications/initialized') return; // nothing to do; acknowledged implicitly
  log(`ignoring unrecognized notification: ${method}`);
}

function handleMessage(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    respondError(null, -32600, 'Invalid Request');
    return;
  }
  // A response TO one of our own outgoing requests (e.g. roots/list) carries no `method` — route
  // it to the pending promise instead of treating it as an inbound request.
  if (msg.method === undefined) {
    if (msg.result !== undefined || msg.error !== undefined) {
      const pending = pendingOutgoing.get(msg.id);
      if (pending) {
        pendingOutgoing.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message));
        else pending.resolve(msg.result);
      }
      return;
    }
    respondError(msg.id ?? null, -32600, 'Invalid Request');
    return;
  }
  if (msg.id === undefined) {
    handleNotification(msg.method);
    return;
  }
  handleRequest(msg.id, msg.method, msg.params).catch((e) => {
    log(`error handling ${msg.method}: ${e.stack || e}`);
    respondError(msg.id, -32603, `Internal error: ${e.message}`);
  });
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    respondError(null, -32700, `Parse error: ${e.message}`);
    return;
  }
  handleMessage(msg);
});
rl.on('close', () => process.exit(0));
