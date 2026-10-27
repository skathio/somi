# SoMi overview page

The source of <https://skathio.github.io/somi/>: one page (roadmap, workflow, cost system with a
resolver demo, guardrails, loop core, measured results) for presenting SoMi. React and Tailwind,
built with Vite. It is its own package with its own lockfile and is not part of the npm package.

## Working on it

```bash
npm --prefix site ci --ignore-scripts   # dependencies from the lockfile, no lifecycle scripts
npm --prefix site run dev               # local server with hot reload
npm --prefix site test                  # unit and content tests, with coverage
npm --prefix site run build             # type check, bundle to site/dist, self-contained check
```

Keyboard while presenting: `←` / `→` move between sections, `P` toggles present mode (one section
per screen), `T` toggles the theme.

## Where the content comes from

- **Read from the repo at build time** by [`scripts/facts.mjs`](scripts/facts.mjs) into
  `src/generated/facts.json` (not committed): the release list and current version (`CHANGELOG.md`
  headings), the command, agent and skill counts, the hook registrations (`hooks/hooks.json`), the
  agent tier table (`scripts/lib/cost-defaults.mjs`) and Claude Code's tier→model map
  (`scripts/lib/cost-model.mjs`). These update themselves.
- **Written by hand** in [`src/content/`](src/content/): the roadmap, a line per command and per
  hook, and the measured results. [`test/content.test.ts`](test/content.test.ts) fails when they
  disagree with the repo: a command, hook or agent added or removed, or a release missing from the
  roadmap.

## With each release

Add the release to [`src/content/roadmap.json`](src/content/roadmap.json): a new entry, or the
version added to an existing entry's `covers`. Every CHANGELOG release must be covered exactly once,
and the last entry is shown as the current release. `scripts/validate.sh` checks this too
([`tests/scripts/lib/site-roadmap-gate.mjs`](../tests/scripts/lib/site-roadmap-gate.mjs)), so a release
cannot be dispatched with the roadmap behind. Update
[`src/content/measured.ts`](src/content/measured.ts) when the release recorded a new usage baseline,
stating only what the sealed rule called.

The release dispatch (`.github/workflows/publish.yml`) builds, tests and deploys the page after the
npm publish. Pull requests run the same build and tests in `ci.yml`'s `site` job.

## Rules the build enforces

- **Nothing from another origin.** No CDN scripts, stylesheets, fonts or images
  ([`scripts/check-dist.mjs`](scripts/check-dist.mjs) runs after every build), so the page renders on
  a presenting device with nothing to fetch beyond GitHub Pages.
- **Facts are not copied.** If a number or name exists in the repo, read it in `facts.mjs` rather
  than typing it into a component.
