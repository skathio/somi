import raw from '../generated/facts.json';
import type { Tier } from './resolver';

export interface Release {
  version: string;
  date: string;
  title: string;
}

export interface Facts {
  version: string;
  releases: Release[];
  commands: string[];
  agents: string[];
  skills: string[];
  hooks: { name: string; event: string }[];
  agentDefaults: Record<string, Tier>;
  defaultCeiling: Tier;
  claudeCodeModels: Record<Tier, string>;
  maxModelCandidates: number;
}

/** Generated from the repo by scripts/facts.mjs; see that file for where each field comes from. */
export const FACTS = raw as Facts;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-25` -> `25 Oct 2026`, or `25 Oct` without the year. */
export function formatDate(iso: string, withYear = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}

export function releaseDate(version: string): string {
  const r = FACTS.releases.find((x) => x.version === version);
  if (!r) throw new Error(`no CHANGELOG release ${version}`);
  return r.date;
}

/** Whole months between the first and the latest release, at least 1. */
export function monthsSpanned(releases: Release[]): number {
  const dates = releases.map((r) => Date.parse(r.date));
  const days = (Math.max(...dates) - Math.min(...dates)) / 86_400_000;
  return Math.max(1, Math.round(days / 30.44));
}
