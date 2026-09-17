#!/usr/bin/env node
// Installs a SoMi definition set into a fixture working tree, and invokes a command against it.
//
// This is the step `fixtures/README.md`'s reconstruction contract left as `<install SoMi into
// "$WORK">` through iterations 3.3b-3.4b. It is decided here, at 3.4b's live path, because the
// choice only becomes forced once something actually runs.
//
// **Project-level, not vendored.** `docs/INSTALL.md` documents a vendored install at
// `.claude/plugins/somi` plus a settings merge, and that is right for a human adopting SoMi. It is
// wrong here: the eval measures the DEFINITION SET, and a vendored layout adds a resolution
// mechanism between the files under test and the agent reading them. If a trim regressed a
// dimension, a vendored install leaves open whether the trim did it or the plugin loader did.
// Copying commands/agents/skills/rules to their project-level locations is the shortest path from
// "these files" to "the agent read these files".
//
// **Zero dependencies**, like everything else here: the agent is invoked as a `claude` subprocess,
// not through an SDK. Adding `@anthropic-ai/claude-agent-sdk` would put a toolchain into a repo
// whose stated identity is a portable zero-dependency Node runtime — the same argument that kept
// the fixtures on plain `.mjs`.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Definition-set directories, in the order a reader would meet them. */
export const DEFINITION_DIRS = ['commands', 'agents', 'skills', 'rules'];

/**
 * Copy a definition set into `workDir` at the locations Claude Code discovers natively.
 *
 * Every OTHER hook stays deliberately NOT installed (they read `SOMI_VENDOR_ROOT`/gate on live
 * policy and would resolve against the eval harness, not the definition set under test); task 01
 * criterion 6's allowlist permits `.somi/audit.log`/`.somi/somi-state/**` by category regardless.
 * **2.2 correction** (`decisions.md#d11`): the PostToolUse audit-log hook ALONE is installed, by
 * absolute path -- without it `.somi/audit.log` is never written live, so task 02's S1 criterion
 * could never produce a `pass`. Safe unconditionally: it only appends a log line, unlike the rest.
 */
export function installSomi(sourceDir, workDir) {
  const dest = join(workDir, '.claude');
  mkdirSync(dest, { recursive: true });
  const installed = [];
  for (const dir of DEFINITION_DIRS) {
    const from = join(sourceDir, dir);
    if (!existsSync(from)) continue;
    cpSync(from, join(dest, dir), { recursive: true });
    installed.push(dir);
  }
  // rules/CLAUDE.md is the ruleset's own entry point; a consuming project reads it as CLAUDE.md.
  const rules = join(sourceDir, 'rules', 'CLAUDE.md');
  if (existsSync(rules) && !existsSync(join(workDir, 'CLAUDE.md'))) {
    cpSync(rules, join(workDir, 'CLAUDE.md'));
  }
  const settings = { permissions: { allow: [] } };
  const auditLogHook = join(sourceDir, 'hooks', 'post-tool', 'audit-log.mjs');
  // Quoted (Nit, 2026-08-27): `sourceDir` is a `git worktree add` path or an operator-supplied
  // `--source` path -- a space anywhere in it broke the registration silently, unquoted.
  if (existsSync(auditLogHook)) settings.hooks = { PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `node "${auditLogHook}"` }] }] };
  writeFileSync(join(dest, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return installed;
}

/**
 * Invoke one command against the installed definition set.
 *
 * `--print` runs non-interactively and returns the final assistant message. The whole point of
 * the corpus is what the agent DOES, so the working tree is inspected afterwards; the transcript
 * is evidence, not the measurement.
 *
 * Returns `{ ok, stdout, stderr, timedOut }` rather than throwing: a run that errors is a data
 * point (it becomes a failure for every dimension the task declares), not an exception that
 * should abort the other nineteen runs.
 */
// 900s (15 min) was too tight and cost a completed draw. Measured agent runs span 3.4 to 13
// minutes, so 15 left almost no headroom -- and a timeout is the most expensive possible outcome:
// the full run is paid for and nothing is recorded. 30 minutes is well clear of the observed
// spread while still bounding a genuinely hung run.
export function invokeCommand(workDir, prompt, { timeoutMs = 1_800_000, model = null, allowedTools = null } = {}) {
  const args = ['--print', '--permission-mode', 'bypassPermissions'];
  if (model) args.push('--model', model);
  if (allowedTools) args.push('--allowed-tools', allowedTools);
  args.push(prompt);

  const res = spawnSync('claude', args, {
    cwd: workDir,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDE_PROJECT_DIR: workDir },
  });
  return {
    ok: res.status === 0 && !res.error,
    status: res.status,
    timedOut: res.error?.code === 'ETIMEDOUT',
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    error: res.error ? String(res.error.message ?? res.error) : null,
  };
}

/**
 * The exact assistant message a session ending on the account limit closes with.
 *
 * A plain substring, not a regex: this literal was confirmed against real transcripts (ten
 * occurrences; ASCII apostrophe), not invented. Lives here, beside `invokeCommand`, because it
 * describes that function's output and both drivers judge it -- `run.mjs`'s draw loop and
 * `convergence.mjs`'s `isHardInvocationFailure()`. Two copies drifted apart once already (F-322).
 */
export const SESSION_LIMIT_SIGNATURE = "You've hit your session limit";

/**
 * The broad quota pattern, used ONLY on an invocation that already failed. See `isQuotaExit()`.
 */
const QUOTA_TEXT = /session limit|rate limit|usage limit|quota/i;

/**
 * Did this invocation end on an account quota condition rather than on the task it was given?
 *
 * Deliberately ASYMMETRIC, because a false positive does not cost the same on both sides:
 *
 * - **Failed invocation** (`ok === false`) -- matched on the BROAD pattern. The run produced no
 *   usable observation either way, so a false positive only relabels the error and stops the draw
 *   loop early, which is the safe direction mid-outage. This is also the only shape observed end
 *   to end: `run.mjs` caught four real session-limit exits through exactly this gate.
 * - **Succeeded invocation** (`ok === true`) -- matched on the EXACT literal AND corroborated by
 *   `didWork === false`. F-321: this branch was not checked at all, so an `ok:true` session-limit
 *   exit was graded as draw data. But applying the broad pattern here would be WORSE than the bug
 *   it fixes: these tasks run an agent against this very repo, whose own docs and plans discuss
 *   quota and session limits constantly, so a healthy draw whose transcript contains "quota" is
 *   ordinary rather than suspicious. Discarding those would silently delete good draws at ~644s
 *   each. Every real incident did no work at all, so that is the corroboration required -- the
 *   same discipline `convergence.mjs` applies via its completed-draw gate (F-324b).
 *
 * `timedOut` is never a quota exit: a subprocess killed at the wall clock is the wait-cap path's
 * business, not an operator condition to wait out.
 *
 * @param {{ok: boolean, timedOut: boolean, stdout: string, stderr: string}|null|undefined} invocation
 * @param {{didWork: boolean|null}} [corroboration] `didWork` is whether the run left ANY trace --
 *   a changed file or a recorded tool call. `null`/omitted means "unknown", which never promotes
 *   an `ok:true` run to a quota exit.
 * @returns {boolean}
 */
export function isQuotaExit(invocation, { didWork = null } = {}) {
  if (invocation == null || invocation.timedOut) return false;
  const text = `${invocation.stdout ?? ''}\n${invocation.stderr ?? ''}`;
  if (!invocation.ok) return QUOTA_TEXT.test(text);
  return text.includes(SESSION_LIMIT_SIGNATURE) && didWork === false;
}

/** Files the run created or modified, relative to the baseline commit. Evidence for S3. */
export function workingTreeDiff(workDir) {
  const git = (...a) => execFileSync('git', a, { cwd: workDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const changed = git('status', '--porcelain', '--untracked-files=all')
      .split('\n').filter(Boolean)
      .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }));
    return { changed, diff: git('diff', 'HEAD') };
  } catch (err) {
    return { changed: [], diff: '', error: String(err.message ?? err) };
  }
}

/** Remove the installed definition set so it is not mistaken for candidate output when scoring. */
export function uninstallSomi(workDir) {
  rmSync(join(workDir, '.claude'), { recursive: true, force: true });
}

/** Whether an invocation path exists at all. Checked before a run rather than discovered mid-way. */
export function preflight() {
  const problems = [];
  const which = spawnSync('command', ['-v', 'claude'], { shell: true, encoding: 'utf8' });
  if (which.status !== 0) problems.push('the `claude` CLI is not on PATH');
  const credFile = join(process.env.HOME ?? '', '.claude', '.credentials.json');
  const hasCred = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || existsSync(credFile);
  if (!hasCred) problems.push('no credential found (ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or ~/.claude/.credentials.json)');
  return { ready: problems.length === 0, problems };
}
