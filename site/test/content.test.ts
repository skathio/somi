// The hand-written content must match the repo it describes. Each check here fails when the plugin changes
// and the page was not updated with it: that is how the page stays current from release to release.
import { describe, expect, it } from 'vitest';
import { ROADMAP as roadmap } from '../src/content/roadmap';
import { COMMANDS } from '../src/content/commands';
import { HOOK_EVENTS, HOOKS } from '../src/content/hooks';
import { FACTS, formatDate, monthsSpanned } from '../src/lib/facts';

const sorted = (xs: string[]) => [...xs].sort();

describe('content matches the repo', () => {
  it('places every command in commands/, and only those', () => {
    expect(sorted(Object.keys(COMMANDS))).toEqual(sorted(FACTS.commands));
  });

  it('describes every registered hook, and only those', () => {
    expect(sorted(Object.keys(HOOKS))).toEqual(sorted(FACTS.hooks.map((h) => h.name)));
    for (const h of FACTS.hooks) expect(HOOK_EVENTS, h.event).toHaveProperty(h.event);
  });

  it('covers every CHANGELOG release exactly once on the roadmap', () => {
    const covered = roadmap.eras.flatMap((e) => e.entries.flatMap((x) => x.covers));
    expect(sorted(covered)).toEqual(sorted(FACTS.releases.map((r) => r.version)));
    for (const e of roadmap.eras.flatMap((x) => x.entries)) expect(e.covers).toContain(e.version);
  });

  it('shows the latest release as the current one', () => {
    const last = roadmap.eras.at(-1)!.entries.at(-1)!;
    expect(last.version).toBe(FACTS.version);
  });

  it('has a default tier for every specialist agent', () => {
    expect(sorted(Object.keys(FACTS.agentDefaults))).toEqual(sorted(FACTS.agents.filter((a) => a !== 'somi')));
  });
});

describe('fact helpers', () => {
  it('formats dates', () => {
    expect(formatDate('2026-10-25')).toBe('25 Oct 2026');
    expect(formatDate('2026-05-01', false)).toBe('1 May');
  });
  it('counts whole months, at least one', () => {
    expect(monthsSpanned([{ version: 'a', date: '2026-05-21', title: '' }, { version: 'b', date: '2026-10-25', title: '' }])).toBe(5);
    expect(monthsSpanned([{ version: 'a', date: '2026-05-21', title: '' }])).toBe(1);
  });
});

describe('parseReleases', async () => {
  // @ts-expect-error -- a plain .mjs build script without type declarations
  const { parseReleases } = await import('../scripts/facts.mjs');
  it('reads dated release headings and skips [Unreleased]', () => {
    const text = '# Changelog\n\n## [Unreleased]\n\n## [4.1.0] — 2026-11-02 — feat: x\n\nbody\n\n## [4.0.0] — 2026-10-25 — feat!: y\n';
    expect(parseReleases(text)).toEqual([
      { version: '4.1.0', date: '2026-11-02', title: 'feat: x' },
      { version: '4.0.0', date: '2026-10-25', title: 'feat!: y' },
    ]);
  });
  it('ignores headings that are not releases', () => {
    expect(parseReleases('## [4.1.0] - 2026-11-02 - hyphens\n## Notes\n')).toEqual([]);
  });
});
