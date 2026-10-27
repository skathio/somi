// Every slash command in commands/, placed on the page. test/content.test.ts fails when this list and
// commands/*.md disagree, so a new or removed command forces an update here.

export type CommandGroup = 'front-load' | 'plan' | 'code' | 'review' | 'pipeline' | 'lane' | 'lens' | 'config';

export interface CommandInfo {
  group: CommandGroup;
  blurb: string;
}

export const COMMANDS: Record<string, CommandInfo> = {
  discover: { group: 'front-load', blurb: 'A new product: researched requirements and a high-level design.' },
  design: { group: 'front-load', blurb: 'A brownfield feature: the expensive-to-reverse decisions, settled against the code.' },
  'refactor-design': { group: 'front-load', blurb: 'A refactor too big for one diff: seams, risks and a destination shape.' },

  plan: { group: 'plan', blurb: 'Phases, risks, a definition of done and a test strategy.' },
  'plan-loop': { group: 'plan', blurb: 'Plan, review, revise, under an iteration cap.' },

  code: { group: 'code', blurb: 'Implements against the plan and keeps it in sync.' },
  'code-loop': { group: 'code', blurb: 'Code, review, fix, under pass, diff and recurrence caps.' },
  'code-parallel': { group: 'code', blurb: 'Independent iterations in isolated worktrees, integrated one at a time.' },

  review: { group: 'review', blurb: 'A strict, fresh-context review with graded findings.' },
  'review-panel': { group: 'review', blurb: 'Several review lenses at once, merged into one verdict.' },
  pr: { group: 'review', blurb: 'The PR title and description, composed from the artifacts.' },

  ship: { group: 'pipeline', blurb: 'Plan, code and review, gated at every stage.' },
  'ship-loop': { group: 'pipeline', blurb: 'Sized, one gate, then the loops run to completion.' },

  debug: { group: 'lane', blurb: 'Reproduce first, isolate under a hypothesis budget, and keep the repro test as the regression guard.' },
  incident: { group: 'lane', blurb: 'Production is down: mitigate fast with the hooks still on, then a postmortem and a follow-up are mandatory.' },
  impact: { group: 'lane', blurb: 'Read-only blast radius: proceed, design first, or reconsider.' },
  atlas: { group: 'lane', blurb: 'One deep, SHA-stamped read of the repo that later designs reuse.' },
  refactor: { group: 'lane', blurb: 'A named smell fixed in one behaviour-preserving diff.' },
  upgrade: { group: 'lane', blurb: 'Dependency upgrades: research the changelog, scan usage, migrate under the loop.' },
  'release-readiness': { group: 'lane', blurb: 'The pre-release gate: open findings, definition of done, rollback.' },
  adopt: { group: 'lane', blurb: 'Onboard an existing codebase: atlas, conventions, and a gap report.' },

  'security-review': { group: 'lens', blurb: 'Trust boundaries to sinks, with explicit attack paths.' },
  'architecture-review': { group: 'lens', blurb: 'Boundaries, contracts, dependency direction, reversibility.' },
  'test-strategy': { group: 'lens', blurb: 'What to test, at which level, and what not to.' },

  'somi-config': { group: 'config', blurb: 'See and change the ceiling, per-agent tiers and model mapping.' },
};

export const commandsIn = (group: CommandGroup): string[] =>
  Object.keys(COMMANDS).filter((c) => COMMANDS[c].group === group);
