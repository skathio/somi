// Every hook registered in hooks/hooks.json, described for the guardrails section. test/content.test.ts
// fails when this list and the registrations disagree.

export const HOOKS: Record<string, string> = {
  'block-dangerous-bash': '**Dangerous shell:** recursive deletes of the root or home, force-push to protected branches, piping a download into a shell, shell writes to SoMi state.',
  'block-secret-writes': '**Secret writes:** environment files, private keys and certificates, in the write-tool shapes of both hosts.',
  'guard-protected-paths': '**Protected paths:** `.git/`, `node_modules/`, SoMi state.',
  'gate-dep-install': '**Dependency installs** need your acknowledgement.',
  'audit-log': '**Audit log** of every tool call in `.somi/audit.log`.',
  'inject-digest': '**Rules digest** once per session, with a loud warning when the sandbox is off.',
};

export const HOOK_EVENTS: Record<string, string> = {
  PreToolUse: 'Before a tool runs',
  PostToolUse: 'After a tool runs',
  SessionStart: 'At session start',
};
