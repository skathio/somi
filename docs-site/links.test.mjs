// Unit rules for links.mjs and h1-label.mjs: link targets, GitHub heading ids, brace escaping
// and the sidebar label of an unlisted page. These run without a build;
// docs-site-build.test.mjs checks the same behaviour on the built site.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h1Label } from './h1-label.mjs'
import { escapeBraces, githubSlug, rewriteLink } from './links.mjs'

const REPO = 'https://github.com/skathio/somi'
const GITHUB = `${REPO}/blob/main/`
const opts = {
  unpublished: ['VERSIONING.md'],
  rewrites: { 'getting-started.md': 'index.md' },
  isFolder: (p) => ['benchmarks/records/', 'benchmarks/records'].includes(p),
}

test('links that leave docs/ go to the GitHub blob with the query and anchor kept', () => {
  assert.equal(rewriteLink('hosts.md', '../README.md#install', opts), `${GITHUB}README.md#install`)
  assert.equal(rewriteLink('BENCHMARK.md', '../benchmarks/records/a.md', opts), `${GITHUB}benchmarks/records/a.md`)
  assert.equal(rewriteLink('hosts.md', '../.github/hooks/somi.json?plain=1#L2', opts), `${GITHUB}.github/hooks/somi.json?plain=1#L2`)
  assert.equal(rewriteLink('hosts.md', '../commands/a%20b.md#x', opts), `${GITHUB}commands/a%20b.md#x`, 'escapes are kept')
})

test('a link to a folder of the repo opens its tree, with or without a trailing slash', () => {
  assert.equal(rewriteLink('BENCHMARK.md', '../benchmarks/records/', opts), `${REPO}/tree/main/benchmarks/records/`)
  assert.equal(rewriteLink('BENCHMARK.md', '../benchmarks/records#top', opts), `${REPO}/tree/main/benchmarks/records#top`)
  assert.equal(rewriteLink('hosts.md', '..', opts), `${REPO}/tree/main/`)
  assert.equal(rewriteLink('hosts.md', '../#readme', opts), `${REPO}/tree/main/#readme`)
})

test('links to the unpublished VERSIONING.md go to GitHub with the query and anchor kept', () => {
  assert.equal(rewriteLink('hosts.md', 'VERSIONING.md#tags', opts), `${GITHUB}docs/VERSIONING.md#tags`)
  assert.equal(rewriteLink('hosts.md', './VERSIONING.md?plain=1', opts), `${GITHUB}docs/VERSIONING.md?plain=1`)
})

test('links between published pages are left to VitePress, so a dead one reaches the dead-link check', () => {
  assert.equal(rewriteLink('hosts.md', 'configuration.md#tiers', opts), null)
  assert.equal(rewriteLink('hosts.md', 'missing.md', opts), null)
})

test('a link to the rewritten home page follows it with the anchor kept', () => {
  assert.equal(rewriteLink('hosts.md', 'getting-started.md#install', opts), 'index.md#install')
  for (const href of ['constructor', '__proto__', 'toString']) {
    assert.equal(rewriteLink('hosts.md', href, opts), null, `${href} is not taken for a rewrite`)
  }
})

test('URLs, site paths, in-page anchors, links out of the repo and non-links are left alone', () => {
  for (const href of ['https://example.com/a.md', 'mailto:x@example.com', '/somi/', '#tiers', '../../x.md', '%E0%A4%A.md', '']) {
    assert.equal(rewriteLink('hosts.md', href, opts), null, href)
  }
  for (const args of [[], ['hosts.md'], ['hosts.md', 5, opts], ['hosts.md', null, opts], [undefined, '../README.md', opts]]) {
    assert.equal(rewriteLink(...args), null, JSON.stringify(args))
  }
})

test('options left out mean nothing is unpublished, rewritten or a folder', () => {
  assert.equal(rewriteLink('hosts.md', 'VERSIONING.md'), null)
  assert.equal(rewriteLink('hosts.md', '../README.md'), `${GITHUB}README.md`)
})

test('heading ids follow GitHub: punctuation dropped, hyphen runs kept, leading digits kept', () => {
  assert.equal(githubSlug('Start on your tier’s model with `somi launch`'), 'start-on-your-tiers-model-with-somi-launch')
  assert.equal(githubSlug('Review — and the gate'), 'review--and-the-gate')
  assert.equal(githubSlug('1. Install'), '1-install')
  assert.equal(githubSlug('forbid_imports'), 'forbid_imports')
})

test('braces in rendered text become entities, so Vue never evaluates them', () => {
  assert.equal(escapeBraces('<code>{{ 2 + 2 }}</code>'), '<code>&#123;&#123; 2 + 2 &#125;&#125;</code>')
  assert.equal(escapeBraces('no braces'), 'no braces')
})

test('an unlisted page is labelled by its H1, in any form GitHub renders', () => {
  assert.equal(h1Label('# Title #\n', 'f.md'), 'Title', 'closing hashes are not part of the heading')
  assert.equal(h1Label('   # Indented\n', 'f.md'), 'Indented', 'up to three leading spaces')
  assert.equal(h1Label('Setext title\n===\n\ntext\n', 'f.md'), 'Setext title')
  assert.equal(h1Label('# See [the guide](./hosts.md)\n', 'f.md'), 'See the guide')
  assert.equal(h1Label('```bash\n# a comment\n```\n# Real\n', 'f.md'), 'Real', 'a comment in a code block is not the H1')
  assert.equal(h1Label('# A & <b>\n', 'f.md'), 'A &amp; &lt;b>', 'sidebar text is HTML')
})

test('a page with no usable H1 falls back to its file name', () => {
  for (const md of ['# \n\ntext\n', '#\n', '## Only an H2\n', '    # code, four spaces in\n', '', undefined, null, 5, {}]) {
    assert.equal(h1Label(md, 'f.md'), 'f.md', JSON.stringify(md))
  }
})
