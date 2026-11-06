// Runs every fixture in tests/hooks/cases against the real hook scripts, and proves a deny lands on both hosts' payload shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './helpers.mjs';
import { projectRoot } from '../hooks/lib/common.mjs';

const CASES = path.join(REPO, 'tests', 'hooks', 'cases');

function runHook(script, payload, { files = {}, config, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-hook-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    if (config) {
      fs.mkdirSync(path.join(dir, '.somi'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.somi', 'config.json'), JSON.stringify(config));
    }
    const log = path.join(dir, 'audit.log');
    const expand = (v) => (typeof v === 'string' ? v.replaceAll('{{CASE_DIR}}', dir) : v);
    const r = spawnSync(process.execPath, [path.join(REPO, 'hooks', script)], {
      input: expand(JSON.stringify(payload)), encoding: 'utf8', cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, SOMI_GLOBAL_CONFIG: '', SOMI_AUDIT_LOG: log, CLAUDE_PROJECT_DIR: dir, ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, expand(v)])) },
    });
    let out = null;
    try { out = JSON.parse(r.stdout); } catch { /* an allow prints nothing */ }
    return { status: r.status, stderr: r.stderr, out, audit: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision ?? r.out?.permissionDecision ?? 'allow';

for (const file of fs.readdirSync(CASES).filter((f) => f.endsWith('.json'))) {
  const { script, cases } = JSON.parse(fs.readFileSync(path.join(CASES, file), 'utf8'));
  for (const c of cases) {
    test(`${file.replace('.json', '')}: ${c.name}`, () => {
      const r = runHook(script, c.payload, c);
      if (c.expect === 'deny') {
        assert.equal(r.status, 2, 'a deny exits 2 on both hosts');
        assert.equal(decision(r), 'deny');
        if (c.expect_reason) assert.ok(r.stderr.includes(c.expect_reason), r.stderr);
      } else if (c.expect === 'ask') {
        assert.equal(decision(r), 'ask');
      } else if (c.expect === 'allow') {
        assert.equal(r.status, 0);
        assert.equal(decision(r), 'allow');
      }
      if (c.expect_audit_log) assert.ok(r.audit?.includes(c.expect_audit_log), r.audit);
      if (c.expect_no_audit_log) assert.equal(r.audit, null);
    });
  }
}

const PROTECTED = 'pre-tool/guard-protected-paths.mjs';

test('a protected write is denied on Claude Code', () => {
  const r = runHook(PROTECTED, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/repo/.somi/state/journal.jsonl' } });
  assert.equal(r.status, 2);
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(r.stderr.length > 0, 'Claude Code reads the reason from stderr');
});

test('a protected write is denied on Copilot CLI, in its own output shape', () => {
  const r = runHook(PROTECTED, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { path: '/repo/.somi/state/journal.jsonl' } });
  assert.equal(r.status, 2);
  assert.equal(r.out.permissionDecision, 'deny');
  assert.ok(r.out.permissionDecisionReason.length > 0);
});

test('the digest arrives once at session start, on each host', () => {
  const hook = 'session-start/inject-digest.mjs';
  const claude = runHook(hook, { hook_event_name: 'SessionStart' });
  assert.match(claude.out.hookSpecificOutput.additionalContext, /SoMi rules/);
  assert.match(claude.out.hookSpecificOutput.additionalContext, /SoMi CLI: `node "/);
  assert.match(claude.out.additionalContext, /SoMi rules/, 'Copilot CLI reads the top-level field');
});

test('session start says when SoMi is not the active agent, and only then', () => {
  const hook = 'session-start/inject-digest.mjs';
  const said = (payload) => /not the active agent/.test(runHook(hook, payload).out.hookSpecificOutput.additionalContext);
  assert.equal(said({ hook_event_name: 'SessionStart' }), true);
  assert.equal(said({ hook_event_name: 'SessionStart', agent_type: 'other' }), true);
  assert.equal(said({ hook_event_name: 'SessionStart', agent_type: 'somi:somi' }), false);
  assert.equal(said({ hook_event_name: 'SessionStart', agent_type: 'somi' }), false);
});

test('session start warns loudly when the sandbox is off, and not when it is on', () => {
  const hook = 'session-start/inject-digest.mjs';
  assert.match(runHook(hook, {}).out.hookSpecificOutput.additionalContext, /WARNING: the OS sandbox/);
  const on = { '.claude/settings.json': JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false } }) };
  assert.doesNotMatch(runHook(hook, {}, { files: on }).out.hookSpecificOutput.additionalContext, /WARNING/);
});

test('a hook started in a subfolder finds the repository, and with none above it stays where it started', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-root-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sub = path.join(dir, 'repo', 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(dir, 'repo', '.git'));
  const loose = path.join(dir, 'loose');
  fs.mkdirSync(loose);
  const before = process.env.CLAUDE_PROJECT_DIR;
  t.after(() => { if (before === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = before; });
  process.env.CLAUDE_PROJECT_DIR = sub;
  assert.equal(projectRoot(), path.join(dir, 'repo'));
  process.env.CLAUDE_PROJECT_DIR = loose;
  assert.equal(projectRoot(), loose);
});
