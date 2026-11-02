// Every listed slash command, placed on the page. test/content.test.ts fails when this list and the listed
// commands disagree, so a new or removed command forces an update here.

export const COMMANDS: Record<string, string> = {
  somi: 'The default. Say what you want or pass a ticket, and it routes the work.',
  code: 'Build one clear change, with a review only if the diff calls for it.',
  debug: 'Fix a bug whose cause is unknown, starting from a failing test.',
  refactor: 'Change structure and keep behaviour, under green tests.',
  plan: 'Split large work into milestones that each get fresh context.',
  design: 'Settle an expensive-to-reverse choice, with options and reversal costs.',
  review: 'One fresh review, on request.',
  'security-review': 'A security review on the strong tier, tracing input to each sink.',
  upgrade: 'Move a dependency, from its real changelog.',
  incident: 'Restore production first, then record the follow-up.',
  'a11y-check': 'Build or fix interface against an accessibility checklist and checker.',
  ship: 'Runs the full suite, then writes the pull request text from the journal.',
  status: 'Open work, logged findings and decisions, rendered from the journal.',
  'somi-config': 'Shows which model each tier uses in this environment.',
};
