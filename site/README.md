# SoMi overview page

The source of <https://skathio.github.io/somi/>: one page (roadmap, workflow, guardrails, review policy, measurement) for presenting SoMi. React and Tailwind,
built with Vite. It is its own package with its own lockfile and is not part of the npm package.

## Working on it

```bash
npm --prefix site ci --ignore-scripts   # dependencies from the lockfile, no lifecycle scripts
npm --prefix site run dev               # local server with hot reload
npm --prefix site test                  # unit and content tests, with coverage
npm --prefix site run build             # type check, bundle to site/dist, self-contained check
```

Keyboard while presenting: `←` / `→` move between sections, `P` toggles present mode (one section
per screen), `T` steps the theme (auto, light, dark), as the toggle in the header does.

The header is hashira's shared `<site-nav>` (its site kit: `tokens.css`, `theme.js`, `site-nav.js`),
which the pages build copies into `dist/_kit/` after `npm run build`, so the header bar and the theme
toggle are missing under `npm run dev`. The theme is stored under the kit's `theme` key, shared with
the docs. `check-dist` lets those three kit files be absent and still checks every other reference.

## Where the content comes from

- **Read from the repo at build time** by [`scripts/facts.mjs`](scripts/facts.mjs) into
  `src/generated/facts.json` (not committed): the release list and current version (`CHANGELOG.md`
  headings), the command, agent and skill counts, and the hook registrations (`hooks/hooks.json`).
  These update themselves.
- **Written by hand** in [`src/content/`](src/content/): the roadmap, a line per command and per
  hook. The measured results are in [`src/components/Measured.tsx`](src/components/Measured.tsx). [`test/content.test.ts`](test/content.test.ts) fails when they
  disagree with the repo: a command, hook or agent added or removed, or a release missing from the
  roadmap.

## With each release

Add the release to [`src/content/roadmap.json`](src/content/roadmap.json): a new entry, or the
version added to an existing entry's `covers`. Every CHANGELOG release must be covered exactly once,
and the last entry is shown as the current release. `npm test` checks this too, so a release cannot be dispatched with the roadmap behind.

## Deploying

[`.github/workflows/site.yml`](../.github/workflows/site.yml) deploys the page at `/somi/` and the
docs at `/somi/docs/` through hashira's `pages-site.yml`: it runs `npm run build` here into `dist/`,
then adds hashira's site kit in `dist/_kit/` and builds the docs from `../docs/` and
[`.github/pages.json`](../.github/pages.json) into `dist/docs/`. `public/` must therefore hold no
`docs/` or `_kit/` folder. It runs two ways:

- **On its own, with no npm release:** Actions → site → Run workflow on `main`, or
  `gh workflow run site.yml --ref main`. Use it for a page-only change between releases.
- **With every release:** the release dispatch (`publish.yml`) builds the page and the docs before the
  npm publish, and calls it after the publish to deploy that build.

Only `main` can deploy (the `github-pages` Environment's branch policy). Pull requests run the
same build in `site-check.yml`'s `site` job, through `pages-site.yml` with `deploy: false`: the page's build
and tests, the kit and the docs, without deploying.

## Brand

[`brand/somi-mark.svg`](brand/somi-mark.svg) is the master: the SoMi eye in the skathio family style
(a dark disc, a deep red ring, three tomoe and the pupil glowing red). Every PNG is rendered from it at
its exact size, committed: [`brand/somi-icon-800.png`](brand/somi-icon-800.png) (the repository's GitHub
icon and the homepage card), `.claude-plugin/icon.png` (800, the plugin's icon) and these:

| File | Size | Used for |
|---|---|---|
| `public/favicon-32.png` | 32 | browser tab |
| `public/icon-192.png` | 192 | high-DPI and Android tab icon, and the header logo in `<site-nav>` |
| `public/apple-touch-icon.png` | 180 | iOS home screen (on the page's dark canvas: iOS fills transparency with black) |
| `public/icon-512.png` | 512 | link previews (`og:image`) |
| `src/assets/somi-icon.png` | 480 | the hero logo (shown at up to 240 px, so sharp at 2×) |

The accent colour is the icon's red (`#cc1111`), darkened to `#b80f0f` on the light theme for text
contrast. When the icon changes, edit the master and render each size from it with a headless
browser (transparent background; the apple-touch icon on the dark canvas `#101216`); `check-dist` fails a build without a favicon or with a preview image the
build did not emit.

## Rules the build enforces

- **Nothing from another origin.** No CDN scripts, stylesheets, fonts or images
  ([`scripts/check-dist.mjs`](scripts/check-dist.mjs) runs after every build), so the page renders on
  a presenting device with nothing to fetch beyond GitHub Pages.
- **Facts are not copied.** If a number or name exists in the repo, read it in `facts.mjs` rather
  than typing it into a component.
