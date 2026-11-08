// Every listed slash command, placed on the page. test/content.test.ts fails when this list and the listed
// commands disagree, so a new or removed command forces an update here.

export const COMMANDS: Record<string, string> = {
  somi: 'The default. Give it any request or ticket, and it routes the work to the right workflow.',
  code: 'Build one clear change, with a review only if the diff calls for it.',
  debug: 'Fix a bug whose cause is unknown, starting from a failing test.',
  refactor: 'Change structure and keep behaviour, under green tests.',
  plan: 'Split large work into milestones that each get fresh context.',
  design: 'Settle an expensive-to-reverse choice, with options and reversal costs.',
  review: 'Review the current changes or a named diff once.',
  'security-review': 'Review for security on the strong tier, tracing input to each sink.',
  upgrade: 'Upgrade a dependency from its real changelog and migrate its uses.',
  incident: 'Restore a broken production service first, then record the follow-up.',
  'a11y-check': 'Build or fix interface against an accessibility checklist and checker.',
  ship: 'Run the full suite, then write the pull request text.',
  'somi-config': 'Show which model each tier uses in this environment.',
};
