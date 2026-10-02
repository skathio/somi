#!/usr/bin/env node
// Drives scripts/somi-mcp.mjs over REAL stdio JSON-RPC (via somi-mcp-client.mjs) to prove the
// bundled MCP server behaves identically to scripts/somi-dispatch.mjs's CLI (they share
// scripts/lib/dispatch-resolver.mjs) and that its own project-root resolution
// (scripts/lib/mcp-project-root.mjs) follows the documented order without ever touching this
// repo's own .somi/somi-state/. Every scenario runs against its own throwaway temp directory.
//
// Invoked from tests/scripts/somi-mcp.sh, which is wired into scripts/validate.sh.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from './somi-mcp-client.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER = path.join(ROOT, 'scripts', 'somi-mcp.mjs');
const CLI = path.join(ROOT, 'scripts', 'somi-dispatch.mjs');

let pass = 0;
let fail = 0;
function ok(name) { pass++; console.log(`  ok   ${name}`); }
function bad(name, detail) { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); }
function check(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(name);
  else bad(name, `want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'somi-mcp-test-'));
function fresh() {
  const d = path.join(tmpRoot, `p${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

async function withClient(env, fn) {
  const client = new McpClient(SERVER, { env });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function toolCall(client, name, args) {
  return client.request('tools/call', { name, arguments: args });
}

function toolText(result) {
  return result?.content?.[0]?.text ?? '';
}

async function run() {
  console.log('== somi-mcp (stdio MCP server) ==');

  // --- initialize / tools/list -------------------------------------------------------------
  await withClient({}, async (client) => {
    const init = await client.initialize();
    check('initialize echoes the requested protocolVersion', init.protocolVersion, '2024-11-05');
    check('initialize reports capabilities.tools', init.capabilities?.tools, {});
    check('initialize reports serverInfo.name', init.serverInfo?.name, 'somi');

    const list = await client.request('tools/list', {});
    const names = (list.tools || []).map((t) => t.name).sort();
    check('tools/list carries exactly somi_resolve, somi_command, somi_skill and somi_agent', names, ['somi_agent', 'somi_command', 'somi_resolve', 'somi_skill']);

    const ping = await client.request('ping', {});
    check('ping returns an empty result', ping, {});
  });

  // --- somi_resolve success matches the CLI's own output for the same args ------------------
  await withClient({}, async (client) => {
    await client.initialize();
    const proj = fresh();
    const result = await toolCall(client, 'somi_resolve', { agent: 'coder', host: 'claude-code', project_dir: proj });
    const mcpJson = JSON.parse(toolText(result));

    const cliOut = execFileSync(process.execPath, [CLI, 'resolve', '--agent', 'coder', '--host', 'claude-code'], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: fresh() },
      encoding: 'utf8',
    });
    const cliJson = JSON.parse(cliOut);
    check(
      'somi_resolve (project_dir arg) matches the CLI byte-for-shape on tier/model/supported',
      { tier: mcpJson.tier, model: mcpJson.model, supported: mcpJson.supported, agent: mcpJson.agent },
      { tier: cliJson.tier, model: cliJson.model, supported: cliJson.supported, agent: cliJson.agent },
    );
    check('the resolved project dir is where ceiling state actually landed', existsSync(path.join(proj, '.somi', 'somi-state', 'ceiling.json')), true);
  });

  // --- the four failure codes surface as isError with the matching code --------------------
  await withClient({}, async (client) => {
    await client.initialize();

    let r = await toolCall(client, 'somi_resolve', { agent: '../etc/passwd', project_dir: fresh() });
    check('64 (usage: invalid agent) is isError', r.isError, true);
    check('64 appears in the error text', /\(exit 64\)/.test(toolText(r)), true);

    r = await toolCall(client, 'somi_resolve', { agent: 'totally-not-a-real-agent', project_dir: fresh() });
    check('65 (unknown agent) is isError', r.isError, true);
    check('65 appears in the error text', /\(exit 65\)/.test(toolText(r)), true);

    r = await toolCall(client, 'somi_resolve', { agent: 'somi', project_dir: fresh() });
    check('66 (malformed: somi is exempt) is isError', r.isError, true);
    check('66 appears in the error text', /\(exit 66\)/.test(toolText(r)), true);
    check("66's message names the exemption, matching the CLI's own wording", /exempt/.test(toolText(r)), true);

    const brokenProj = fresh();
    mkdirSync(path.join(brokenProj, '.somi'), { recursive: true });
    writeFileSync(path.join(brokenProj, '.somi', 'config.json'), '{"cost": {"ceiling": "low"}\n'); // missing brace
    r = await toolCall(client, 'somi_resolve', { agent: 'coder', project_dir: brokenProj });
    check('67 (project environment failure: unparsable config.json) is isError', r.isError, true);
    check('67 appears in the error text', /\(exit 67\)/.test(toolText(r)), true);
  });

  // --- path traversal rejected before any read ----------------------------------------------
  await withClient({}, async (client) => {
    await client.initialize();
    const proj = fresh();
    const r = await toolCall(client, 'somi_resolve', { agent: '../etc/passwd', project_dir: proj });
    check('path traversal in agent is rejected', r.isError, true);
    check('a rejected agent leaves the project root untouched -- no .somi/ written', existsSync(path.join(proj, '.somi')), false);

    const proj2 = fresh();
    const r2 = await toolCall(client, 'somi_resolve', { agent: 'a/b', project_dir: proj2 });
    check('a bare slash in agent is also rejected', r2.isError, true);
  });

  // --- somi_command: real text, and its own path-traversal rejection ------------------------
  await withClient({}, async (client) => {
    await client.initialize();
    const r = await toolCall(client, 'somi_command', { name: 'plan' });
    check('somi_command returns commands/plan.md content, not an error', r.isError, undefined);
    check('the returned text is really commands/plan.md', toolText(r).includes('# /plan — Planning workflow'), true);

    const bad1 = await toolCall(client, 'somi_command', { name: '../etc/passwd' });
    check('somi_command rejects a path-traversal name', bad1.isError, true);

    const unknown = await toolCall(client, 'somi_command', { name: 'not-a-real-command' });
    check('somi_command rejects an unknown command name', unknown.isError, true);
  });

  // --- somi_skill: real text, and its own allowlist-before-path traversal rejection ---------
  await withClient({}, async (client) => {
    await client.initialize();
    const r = await toolCall(client, 'somi_skill', { name: 'somi-dispatch' });
    check('somi_skill returns skills/somi-dispatch/SKILL.md content, not an error', r.isError, undefined);
    check('the returned text is really skills/somi-dispatch/SKILL.md', toolText(r).includes('somi-dispatch — resolve, then start, one agent'), true);

    const bad1 = await toolCall(client, 'somi_skill', { name: '../x' });
    check('somi_skill rejects a path-traversal name (../x) via the allowlist, before any read', bad1.isError, true);
    check('the traversal rejection is the usual usage code (64), not a filesystem error', /\(exit 64\)/.test(toolText(bad1)), true);

    const unknownSkill = await toolCall(client, 'somi_skill', { name: 'not-a-real-skill' });
    check('somi_skill rejects an unknown skill name', unknownSkill.isError, true);
  });

  // --- somi_agent: the agent's instructions without frontmatter, same allowlist ------------
  await withClient({}, async (client) => {
    await client.initialize();
    const r = await toolCall(client, 'somi_agent', { name: 'reviewer' });
    check('somi_agent returns agents/reviewer.md content, not an error', r.isError, undefined);
    check('the returned text starts at the body: no frontmatter, no model: line', /^---|^model:/m.test(toolText(r)), false);
    check('the returned text is really the reviewer body', toolText(r).length > 1000 && /reviewer/i.test(toolText(r)), true);

    const bad1 = await toolCall(client, 'somi_agent', { name: '../agents/reviewer' });
    check('somi_agent rejects a path-traversal name with the usage code (64)', /\(exit 64\)/.test(toolText(bad1)), true);

    const unknown = await toolCall(client, 'somi_agent', { name: 'not-a-real-agent' });
    check('somi_agent rejects an unknown agent with exit 65', /\(exit 65\)/.test(toolText(unknown)), true);
  });

  // --- unknown tool name -> JSON-RPC error, not a tool result -------------------------------
  await withClient({}, async (client) => {
    await client.initialize();
    let errored = false;
    try {
      await toolCall(client, 'bogus_tool', {});
    } catch {
      errored = true;
    }
    check('an unknown tool name is a JSON-RPC error', errored, true);
  });

  // --- malformed JSON and an unknown method don't kill the server ---------------------------
  await withClient({}, async (client) => {
    await client.initialize();
    client.writeRaw('this is not json');
    const parseErr = await client.waitFor((m) => m.error?.code === -32700);
    check('malformed JSON gets a JSON-RPC parse error', parseErr.error.code, -32700);
    check('a parse error has id: null (nothing to correlate)', parseErr.id, null);

    client.notify('bogus/notification', {});
    client.writeRaw(JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'bogus/method' }));
    const methodErr = await client.waitFor((m) => m.id === 999);
    check('an unknown METHOD gets a JSON-RPC method-not-found error', methodErr.error?.code, -32601);

    // The server must still answer a perfectly good request after all of the above.
    const list = await client.request('tools/list', {});
    check('the server is still alive and answers a valid request afterward', Array.isArray(list.tools), true);
  });

  // --- project-root resolution (scripts/lib/mcp-project-root.mjs) ---------------------------
  // No project_dir, no host root: project_dir alone decides.
  await withClient({}, async (client) => {
    await client.initialize();
    const proj = fresh();
    const r = await toolCall(client, 'somi_resolve', { agent: 'coder', project_dir: proj });
    check('no host root: project_dir alone decides', r.isError, undefined);
    check('ceiling state landed under the project_dir argument', existsSync(path.join(proj, '.somi', 'somi-state')), true);
  });

  // A HOST root (CLAUDE_PROJECT_DIR) is used directly when no project_dir is given.
  {
    const envProj = fresh();
    await withClient({ CLAUDE_PROJECT_DIR: envProj }, async (client) => {
      await client.initialize();
      const r = await toolCall(client, 'somi_resolve', { agent: 'coder' });
      check('CLAUDE_PROJECT_DIR is used when no project_dir is given', r.isError, undefined);
      check('ceiling state landed under CLAUDE_PROJECT_DIR', existsSync(path.join(envProj, '.somi', 'somi-state')), true);
    });
  }

  // M3: a host root (CLAUDE_PROJECT_DIR) exists AND project_dir is OUTSIDE it -- refused (64),
  // nothing read or written anywhere. This closes the prompt-injection path: model-supplied text
  // choosing both which .somi/config.json is read and where state is written, unconstrained.
  {
    const hostProj = fresh();
    const outsideProj = fresh();
    await withClient({ CLAUDE_PROJECT_DIR: hostProj }, async (client) => {
      await client.initialize();
      const r = await toolCall(client, 'somi_resolve', { agent: 'coder', project_dir: outsideProj });
      check('M3: project_dir outside the host root is refused', r.isError, true);
      check('M3: the refusal is a usage error (64)', /\(exit 64\)/.test(toolText(r)), true);
      check('M3: no .somi/ written under the host root', existsSync(path.join(hostProj, '.somi')), false);
      check('M3: no .somi/ written under the rejected project_dir either', existsSync(path.join(outsideProj, '.somi')), false);
    });
  }

  // M3: a host root exists AND project_dir is INSIDE it (a subdirectory) or EQUAL to it -- both
  // allowed, and project_dir (the more specific path) is what's actually used.
  {
    const hostProj = fresh();
    const insideProj = path.join(hostProj, 'packages', 'sub');
    mkdirSync(insideProj, { recursive: true });
    await withClient({ CLAUDE_PROJECT_DIR: hostProj }, async (client) => {
      await client.initialize();
      const r = await toolCall(client, 'somi_resolve', { agent: 'coder', project_dir: insideProj });
      check('M3: project_dir inside the host root is allowed', r.isError, undefined);
      check('M3: ceiling state landed under project_dir itself, not the host root', existsSync(path.join(insideProj, '.somi', 'somi-state')), true);
      check('M3: the host root itself got no .somi/ written', existsSync(path.join(hostProj, '.somi')), false);

      const r2 = await toolCall(client, 'somi_resolve', { agent: 'coder', project_dir: hostProj });
      check('M3: project_dir equal to the host root is allowed', r2.isError, undefined);
    });
  }

  // M1: a single MCP root (no CLAUDE_PROJECT_DIR) is used when the client declares `roots`.
  await withClient({}, async (client) => {
    await client.initialize({ roots: {} });
    const rootsProj = fresh();
    client.rootsHandler = () => [rootsProj];
    const r = await toolCall(client, 'somi_resolve', { agent: 'coder' });
    check('M1: a single MCP root is used when the client declares the capability', r.isError, undefined);
    check('M1: the server actually asked for roots/list', client.messages.some((m) => m.method === 'roots/list'), true);
    check('M1: ceiling state landed under the root the client returned', existsSync(path.join(rootsProj, '.somi', 'somi-state')), true);
  });

  // M1: a non-file:// root URI is dropped, never resolved as a path under the server's own cwd --
  // with nothing else establishing a root, this must refuse (67), never guess.
  await withClient({}, async (client) => {
    await client.initialize({ roots: {} });
    client.rootsHandler = () => [{ uri: 'not-a-file-uri' }];
    const r = await toolCall(client, 'somi_resolve', { agent: 'coder' });
    check('M1: a non-file root URI is rejected outright (never resolved as a relative path)', r.isError, true);
    check('M1: with only a non-file root offered, "no root" (67) is reported, not a guessed path', /\(exit 67\)/.test(toolText(r)), true);
  });

  // M1: a percent-encoded file:// root URI is decoded with url.fileURLToPath, not hand-sliced --
  // the scratchpad ships both a literal "a%20b" dir and a real "a b" (space) dir so this
  // distinguishes correct decoding from a naive prefix-strip.
  {
    const rootDir = fresh();
    const spaced = path.join(rootDir, 'a b');
    const literalPercent = path.join(rootDir, 'a%20b');
    mkdirSync(spaced, { recursive: true });
    mkdirSync(literalPercent, { recursive: true });
    await withClient({}, async (client) => {
      await client.initialize({ roots: {} });
      client.rootsHandler = () => [{ uri: `file://${encodeURI(spaced)}` }];
      const r = await toolCall(client, 'somi_resolve', { agent: 'coder' });
      check('M1: a percent-encoded root URI resolves (isError undefined)', r.isError, undefined);
      check('M1: it decodes to the REAL space directory, not the literal-percent one', existsSync(path.join(spaced, '.somi', 'somi-state')), true);
      check('M1: the literal "a%20b" directory is untouched', existsSync(path.join(literalPercent, '.somi')), false);
    });
  }

  // M1: more than one MCP root, no project_dir to select one -- ambiguous, refused, never guesses
  // the first one. M1+M3: project_dir selecting exactly one of them is allowed.
  await withClient({}, async (client) => {
    await client.initialize({ roots: {} });
    const rootA = fresh();
    const rootB = fresh();
    client.rootsHandler = () => [rootA, rootB];
    const r = await toolCall(client, 'somi_resolve', { agent: 'coder' });
    check('M1: more than one root with no project_dir is ambiguous and refused', r.isError, true);
    check('M1/M3: ambiguous roots refusal is the project-environment family (67)', /\(exit 67\)/.test(toolText(r)), true);
    check('M1: neither offered root got a .somi/ written', existsSync(path.join(rootA, '.somi')) || existsSync(path.join(rootB, '.somi')), false);

    const r2 = await toolCall(client, 'somi_resolve', { agent: 'coder', project_dir: rootB });
    check('M1+M3: project_dir selecting one of several ambiguous roots is allowed', r2.isError, undefined);
    check('M1+M3: state landed under the SELECTED root', existsSync(path.join(rootB, '.somi', 'somi-state')), true);
    check('M1+M3: the other offered root got nothing written', existsSync(path.join(rootA, '.somi')), false);
  });

  // M1: a root that doesn't exist is rejected, never created (cost-ceiling.mjs's saveState does a
  // recursive mkdir -- this proves it's never reached for a bogus root).
  await withClient({}, async (client) => {
    await client.initialize({ roots: {} });
    const missing = path.join(tmpRoot, `missing-${Math.random().toString(36).slice(2)}`);
    client.rootsHandler = () => [missing];
    const r = await toolCall(client, 'somi_resolve', { agent: 'coder' });
    check('M1: a nonexistent MCP root is rejected', r.isError, true);
    check('M1: it is never silently created', existsSync(missing), false);
  });

  // Nothing establishes a root -> a clear, distinct refusal (67), never a silent fallback. A
  // malformed project_dir (relative, nonexistent) is a usage error (64) regardless.
  await withClient({}, async (client) => {
    await client.initialize(); // no `roots` capability declared
    const r = await toolCall(client, 'somi_resolve', { agent: 'coder' });
    check('no root establishable is isError', r.isError, true);
    check('the error names the reason and how to fix it', /project_dir/.test(toolText(r)), true);
    check('the exit-67 family is used for "cannot establish a root"', /\(exit 67\)/.test(toolText(r)), true);

    let r2 = await toolCall(client, 'somi_resolve', { agent: 'coder', project_dir: 'relative/path' });
    check('a non-absolute project_dir is rejected (64)', /\(exit 64\)/.test(toolText(r2)), true);
    r2 = await toolCall(client, 'somi_resolve', { agent: 'coder', project_dir: '/definitely/does/not/exist/anywhere' });
    check('a nonexistent project_dir is rejected (64)', /\(exit 64\)/.test(toolText(r2)), true);
  });

  // --- m1: a present-but-wrong-shaped argument is 64, never silently defaulted -----------------
  await withClient({}, async (client) => {
    await client.initialize();
    const proj = fresh();
    let r = await toolCall(client, 'somi_resolve', { agent: 'coder', host: ['copilot'], project_dir: proj });
    check('m1: an array-valued host is rejected (64), not silently defaulted', /\(exit 64\)/.test(toolText(r)), true);
    check('m1: a rejected host leaves the project root untouched', existsSync(path.join(proj, '.somi')), false);

    const proj2 = fresh();
    r = await toolCall(client, 'somi_resolve', { agent: 'coder', ceiling: '', project_dir: proj2 });
    check('m1: an empty-string ceiling is rejected (64), not silently defaulted', /\(exit 64\)/.test(toolText(r)), true);
    check('m1: a rejected ceiling leaves the project root untouched', existsSync(path.join(proj2, '.somi')), false);
  });

  // --- m2: an object-valued agent/name is a clean tool error, never a crashed JSON-RPC internal
  // error (-32603) from throwing inside a template-literal interpolation ------------------------
  await withClient({}, async (client) => {
    await client.initialize();
    const r = await toolCall(client, 'somi_resolve', { agent: { toString: null }, project_dir: fresh() });
    check('m2: an object-valued agent (toString: null) is a clean isError, not a crash', r.isError, true);
    check('m2: it is reported as the usual 64, not surfaced as an internal error', /\(exit 64\)/.test(toolText(r)), true);

    const r2 = await toolCall(client, 'somi_command', { name: { toString: null } });
    check('m2: an object-valued somi_command name is a clean isError, not a crash', r2.isError, true);
    check('m2: it is reported as the usual 64, not surfaced as an internal error', /\(exit 64\)/.test(toolText(r2)), true);
  });

  // --- M2: the SAME bad input produces the SAME code through the CLI and the MCP tool ----------
  {
    const badInputs = [
      { name: 'invalid agent name', args: { agent: 'Not-Valid' } },
      { name: 'unrecognized ceiling', args: { agent: 'coder', ceiling: 'ultra' } },
      { name: 'somi is exempt from cost:', args: { agent: 'somi' } },
      { name: 'unknown agent', args: { agent: 'totally-not-a-real-agent' } },
    ];
    for (const { name, args } of badInputs) {
      const proj = fresh();
      const cliArgs = [CLI, 'resolve', '--agent', args.agent];
      if (args.ceiling) cliArgs.push('--ceiling', args.ceiling);
      let cliCode = 0;
      try {
        execFileSync(process.execPath, cliArgs, { env: { ...process.env, CLAUDE_PROJECT_DIR: proj }, stdio: 'pipe' });
      } catch (e) {
        cliCode = e.status;
      }
      await withClient({}, async (client) => {
        await client.initialize();
        const r = await toolCall(client, 'somi_resolve', { ...args, project_dir: fresh() });
        const mcpMatch = /\(exit (\d+)\)/.exec(toolText(r));
        const mcpCode = mcpMatch ? Number(mcpMatch[1]) : 0;
        check(`M2 parity (${name}): CLI exit ${cliCode} === MCP code ${mcpCode}`, mcpCode, cliCode);
      });
    }
  }

  // --- m5: initialize answers with a version it actually supports, never an echo -----------------
  await withClient({}, async (client) => {
    const init = await client.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    check('m5: an unsupported protocolVersion is NOT echoed back', init.protocolVersion, '2025-06-18');
    client.notify('notifications/initialized');
  });
}

run()
  .then(() => {
    console.log(`somi-mcp tests: ${pass} ok, ${fail} failed`);
    rmSync(tmpRoot, { recursive: true, force: true });
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('somi-mcp-tests.mjs crashed:', e.stack || e);
    rmSync(tmpRoot, { recursive: true, force: true });
    process.exit(1);
  });
