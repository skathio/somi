import raw from './roadmap.json';

// roadmap.json is JSON, not TS, so the repo's own zero-dependency release gate
// (tests/scripts/lib/site-roadmap-gate.mjs) can read it without this package installed.

export interface RoadmapEntry {
  /** The release whose CHANGELOG date the entry shows. */
  version: string;
  /** Shown instead of `version` when one entry spans several releases, e.g. "2.1–2.2". */
  label?: string;
  /** Every CHANGELOG release this entry accounts for; together the entries cover each release once. */
  covers: string[];
  title: string;
  major?: boolean;
  body?: string;
  highlights?: { title: string; items: string[] }[];
}

export interface Roadmap {
  intro: string;
  eras: { label: string; entries: RoadmapEntry[] }[];
  open: string;
}

export const ROADMAP = raw as Roadmap;
