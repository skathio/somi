// Every step a shard can join, described for the shards section. test/content.test.ts fails when this list and
// SHARD_STEPS in scripts/lib/shards.mjs disagree. The plugin names in the examples are illustrations, not integrations SoMi ships.

export interface ShardStep {
  when: string;
  examples: string[];
}

export const SHARD_STEPS: Record<string, ShardStep> = {
  'work-item.start': {
    when: 'Work begins',
    examples: ['Read the ticket, its comments and its acceptance criteria from your tracker.', 'Pull the design doc or the runbook the work depends on.'],
  },
  'plan.approved': {
    when: 'You approve a plan',
    examples: ['Turn the milestones into sub-tasks on the ticket.', 'Post the approved plan to the team channel.'],
  },
  'pr.open': {
    when: 'The pull request text is ready',
    examples: ['Open the pull request with your forge plugin.', 'Attach the release checklist, or link the ticket.'],
  },
  'review.done': {
    when: 'A review is recorded',
    examples: ['Post what the reviewer found to chat.', 'Move the ticket on, or file the logged findings as follow-ups.'],
  },
};
