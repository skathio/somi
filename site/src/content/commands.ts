// Every slash command in commands/, placed on the page. test/content.test.ts fails when this list and
// commands/*.md disagree, so a new or removed command forces an update here.

export const COMMANDS: Record<string, string> = {
  task: 'The default. Code, check, and review only if a signal fires on the real diff.',
  plan: 'Opt-in. Feature-sized milestones, each with a test or command that proves it.',
  review: 'One fresh review, on request.',
  ship: 'Runs the full suite, then writes the pull request text from the journal.',
  status: 'Open work, logged findings and decisions, rendered from the journal.',
};
