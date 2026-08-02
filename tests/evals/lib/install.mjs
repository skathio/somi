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
 * Hooks are deliberately NOT installed. They write `.somi/audit.log` and `.somi/somi-state/**`
 * every turn, which task 01 criterion 6 allowlists precisely because they are unavoidable — but
 * they also read `SOMI_VENDOR_ROOT` and would resolve against the eval harness rather than the
 * definition set under test. Excluding them keeps the measured surface equal to the trimmed
 * surface. The criterion's allowlist stays correct either way: it permits those paths, it does
 * not require them.
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
  writeFileSync(join(dest, 'settings.json'), JSON.stringify({ permissions: { allow: [] } }, null, 2) + '\n');
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
export function invokeCommand(workDir, prompt, { timeoutMs = 900_000, model = null, allowedTools = null } = {}) {
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
