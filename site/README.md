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

## Deploying

[`.github/workflows/site.yml`](../.github/workflows/site.yml) builds, tests and deploys the page. It
runs two ways:

- **On its own, with no npm release:** Actions → site → Run workflow on `main`, or
  `gh workflow run site.yml --ref main`. Use it for a page-only change between releases.
- **With every release:** the release dispatch (`publish.yml`) calls it after the npm publish.

Only `main` can deploy (the `github-pages` Environment's branch policy). Pull requests run the same
build and tests in `ci.yml`'s `site` job, without deploying.

## Brand

[`brand/somi-icon-800.png`](brand/somi-icon-800.png) is the master icon (the repository's GitHub
icon; no vector version exists). Every size the page uses is a straight downscale of it, committed:

| File | Size | Used for |
|---|---|---|
| `public/favicon-32.png` | 32 | browser tab |
| `public/icon-192.png` | 192 | high-DPI and Android tab icon |
| `public/apple-touch-icon.png` | 180 | iOS home screen (on the page's dark canvas: iOS fills transparency with black) |
| `public/icon-512.png` | 512 | link previews (`og:image`) |
| `src/assets/somi-icon.png` | 480 | the header and hero logo (shown at up to 240 px, so sharp at 2×) |

The accent colour is the icon's red (`#cc1111`), darkened to `#b80f0f` on the light theme for text
contrast. When the icon changes, replace the master and regenerate the sizes with any image tool
(Lanczos downscale, PNG); `check-dist` fails a build without a favicon or with a preview image the
build did not emit.

## Rules the build enforces

- **Nothing from another origin.** No CDN scripts, stylesheets, fonts or images
  ([`scripts/check-dist.mjs`](scripts/check-dist.mjs) runs after every build), so the page renders on
  a presenting device with nothing to fetch beyond GitHub Pages.
- **Facts are not copied.** If a number or name exists in the repo, read it in `facts.mjs` rather
  than typing it into a component.
