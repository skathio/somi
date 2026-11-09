// Every hook registered in hooks/hooks.json, described for the guardrails section. test/content.test.ts
// fails when this list and the registrations disagree.

export const HOOKS: Record<string, string> = {
  'block-dangerous-bash': '**Dangerous shell:** recursive deletes of the root or home, force-push to protected branches, piping a download into a shell, shell writes to SoMi state.',
  'block-secret-writes': '**Secret writes:** environment files, private keys and certificates, in the write-tool shapes of both hosts.',
  'guard-protected-paths': '**Protected paths:** `.git/`, `node_modules/`, SoMi state.',
  'gate-dep-install': '**Dependency installs** need your acknowledgement.',
  'audit-log': '**Audit log** of every tool call in `.somi/audit.log`.',
  'inject-digest': '**Rules digest and decision ledger** at session start and after compaction, with a loud warning when the sandbox is off.',
  'apply-tier': '**Model tiers** set on every subagent, so they do not depend on an agent remembering.',
  'reviewers-read-only': '**Reviewers stay read-only** on both hosts. The main agent and workers write freely.',
  'capture-prompt': '**Your own words** are kept, so SoMi\'s tools read what you asked and not only the agent\'s summary of it.',
  'review-due': '**The quality gate and a review that is due** are checked before the turn ends, once per change: code over the quality limits goes back to be fixed, and a review is asked for when the diff calls for one and none covers it.',
  'guard-tier-config': '**Changes to the tier models or the quality limits** ask you first.',
};

export const HOOK_EVENTS: Record<string, string> = {
  PreToolUse: 'Before a tool runs',
  PostToolUse: 'After a tool runs',
  SessionStart: 'At session start',
  UserPromptSubmit: 'When you send a message',
  Stop: 'Before a turn ends',
};
