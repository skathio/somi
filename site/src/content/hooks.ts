// Every hook registered in hooks/hooks.json, described for the guardrails section. test/content.test.ts
// fails when this list and the registrations disagree.

export const HOOKS: Record<string, string> = {
  'block-dangerous-bash': '**Dangerous shell:** `rm -rf /`, force-push to protected branches, `curl | sh`.',
  'block-secret-writes': '**Secret writes:** `.env`, `*.pem`, `id_rsa`, in the write-tool shapes of both hosts.',
  'guard-protected-paths': '**Protected paths:** `.git/`, `.claude/`, `node_modules/`.',
  'gate-dep-install': '**Dependency installs** need your acknowledgement.',
  'guard-cost-lowering': '**Cost lowering and remaps** wait for your confirmation.',
  'audit-log': '**Audit log** of every tool call in `.somi/audit.log`.',
  'lint-changed-files': '**Lint** of the changed files.',
  'ensure-default-config': '**Default cost config** written if missing.',
  'detect-repo-instructions': "**Repo awareness:** the repo's own CLAUDE.md and AGENTS.md are surfaced, bounded, and a hostile folder name is never echoed.",
  'inject-workflow-context': '**Workflow reminders** are injected on every prompt.',
};

export const HOOK_EVENTS: Record<string, string> = {
  PreToolUse: 'Before a tool runs',
  PostToolUse: 'After a tool runs',
  SessionStart: 'At session start',
  UserPromptSubmit: 'On every prompt',
};
