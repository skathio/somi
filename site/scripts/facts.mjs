// facts.mjs -- writes src/generated/facts.json: everything the overview page states that the repo itself
// already knows (release list, counts, hook registrations, the agent tier table, the shipped tier→model map).
// Read from the source of each fact rather than copied, so the page cannot drift from the code; the
// hand-written content in src/content/ is checked against this file by the site's tests.
//
// Usage: node scripts/facts.mjs   (run by `npm run build`, `npm test` and `npm run dev`)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const repo = path.resolve(site, '..');
const at = (...p) => path.join(repo, ...p);

// `## [4.0.0] — 2026-10-25 — title`; [Unreleased] has no date and is skipped.
export function parseReleases(changelog) {
  const out = [];
  for (const m of changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2}) — (.+)$/gm)) {
    out.push({ version: m[1], date: m[2], title: m[3].trim() });
  }
  return out;
}

const stems = (dir, ext) =>
  fs.readdirSync(at(dir)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();

function hookFacts() {
  const config = JSON.parse(fs.readFileSync(at('hooks', 'hooks.json'), 'utf8'));
  const hooks = [];
  for (const [event, groups] of Object.entries(config.hooks)) {
    for (const group of groups) {
      for (const h of group.hooks) {
        const m = h.command.match(/hooks\/[a-z-]+\/([a-z-]+)\.mjs/);
        if (!m) throw new Error(`facts: cannot read a hook script from "${h.command}"`);
        hooks.push({ name: m[1], event });
      }
    }
  }
  return hooks;
}

async function main() {
  const releases = parseReleases(fs.readFileSync(at('CHANGELOG.md'), 'utf8'));
  if (!releases.length) throw new Error('facts: no release headings found in CHANGELOG.md');

  const { AGENT_DEFAULT_TIERS, DEFAULT_CEILING_TIER } = await import(pathToFileURL(at('scripts', 'lib', 'cost-defaults.mjs')).href);
  const { HOST_MODELS, MAX_MODEL_CANDIDATES } = await import(pathToFileURL(at('scripts', 'lib', 'cost-model.mjs')).href);

  const agents = stems('agents', '.md');
  const facts = {
    version: releases[0].version,
    releases,
    commands: stems('commands', '.md'),
    agents,
    skills: fs.readdirSync(at('skills')).filter((d) => fs.existsSync(at('skills', d, 'SKILL.md'))).sort(),
    hooks: hookFacts(),
    agentDefaults: { ...AGENT_DEFAULT_TIERS },
    defaultCeiling: DEFAULT_CEILING_TIER,
    claudeCodeModels: { ...HOST_MODELS['claude-code'] },
    maxModelCandidates: MAX_MODEL_CANDIDATES,
  };

  const out = path.join(site, 'src', 'generated', 'facts.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(facts, null, 2)}\n`);
  console.log(`facts: ${path.relative(site, out)} (version ${facts.version}, ${releases.length} releases)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
