// Every listed slash command, placed on the page. test/content.test.ts fails when this list and the listed
// commands disagree, so a new or removed command forces an update here.

export const COMMANDS: Record<string, string> = {
  somi: 'Routes anything, the way the agent does with plain words. Everything else is asked for in the chat.',
  'somi-deliver': 'Runs large work as the staged workflow: scout, build, verify and review, each on its tier. Only you start it.',
  'somi-review': 'Reviews the current changes, whether or not the diff calls for it.',
  'somi-quality': 'Checks the code against the quality limits: the branch, one commit, or the whole codebase.',
  'somi-status': 'Shows the open plan, decisions and findings.',
  'somi-config': 'Shows and changes the models each tier uses and the quality limits, and checks the setup.',
};
