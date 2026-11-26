import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { h1Label } from '../h1-label.mjs'
import { escapeBraces, githubSlug, rewriteLink } from '../links.mjs'

// The docs are read from the repo's docs/ as they are on GitHub: no front matter and no
// link edits. build.sh stages them (with the logo) under artifacts/, because VitePress
// reads one source folder and resolves node modules from the sources.
const repoPath = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const stage = repoPath('artifacts/docs-site')
const srcDir = `${stage}/src`

const REPO = 'https://github.com/skathio/somi'
// The versioning policy stays on GitHub only.
const unpublished = ['VERSIONING.md']

// Short sidebar labels, in reading order. A published page missing here is still listed,
// under its H1, so a new doc never drops out of the sidebar.
const guides: [string, string][] = [
  ['getting-started.md', 'Getting started'],
  ['workflows.md', 'Workflows'],
  ['commands.md', 'Commands'],
  ['configuration.md', 'Configuration'],
  ['hosts.md', 'Hosts'],
  ['shards.md', 'Shards'],
  ['sandbox.md', 'Sandbox and trust'],
  ['ARCHITECTURE.md', 'Architecture'],
  ['BENCHMARK.md', 'Benchmark'],
  ['MIGRATING-TO-5.md', 'Migrating from 4.1 to 5.0'],
]
// A listed guide that is gone would leave /somi/docs/ or a sidebar entry pointing at no page,
// and VitePress checks links in pages, not in the sidebar: fail the build instead.
const missing = guides.map(([g]) => g).filter((g) => !existsSync(repoPath(`docs/${g}`)))
if (missing.length) {
  throw new Error(`docs-site: listed guides missing from docs/: ${missing.join(', ')}`)
}
const unlisted = readdirSync(repoPath('docs'))
  .filter((f) => f.endsWith('.md') && !unpublished.includes(f) && !guides.some(([g]) => g === f))
  .sort()
  .map((f): [string, string] => [f, h1Label(readFileSync(repoPath(`docs/${f}`), 'utf8'), f)])
// /somi/docs/ opens Getting started.
const rewrites: Record<string, string> = { 'getting-started.md': 'index.md' }
const pageLink = (md: string) => `/${(Object.hasOwn(rewrites, md) ? rewrites[md] : md).replace(/(index)?\.md$/, '')}`

// A folder of the repo, which a link opens on GitHub. Only docs/*.md is staged, so a folder
// under docs/ has no page on the site either.
const isFolder = (path: string) => existsSync(repoPath(path)) && statSync(repoPath(path)).isDirectory()

// The overview page keeps its theme under `somi-theme` (light or dark; anything else is auto).
// Before VitePress's own dark-mode check runs, map it onto VitePress's key, so a stored light
// or dark opens the docs in that theme with no flash. Anything else means auto.
const themeFromOverview = `try{var t=localStorage.getItem('somi-theme');localStorage.setItem('vitepress-theme-appearance',t==='light'||t==='dark'?t:'auto')}catch(e){}`
// When the visitor flips the docs toggle, store light or dark under the overview key. The
// observer starts after load, so the initial class does not count as a choice. In auto, VitePress
// also flips the class when the system theme changes, and that is not the visitor's choice: a
// media listener registered here, before VitePress registers its own, marks the flip that
// follows a system change, until the next task, and the observer only records it.
const themeToOverview = `(function(){var r=document.documentElement,d=false,os=false;try{var m=matchMedia('(prefers-color-scheme: dark)'),f=function(){os=true;setTimeout(function(){os=false})};m.addEventListener?m.addEventListener('change',f):m.addListener(f)}catch(e){}document.addEventListener('DOMContentLoaded',function(){d=r.classList.contains('dark');new MutationObserver(function(){var n=r.classList.contains('dark');if(n===d){return}d=n;if(os){return}try{localStorage.setItem('somi-theme',n?'dark':'light')}catch(e){}}).observe(r,{attributes:true,attributeFilter:['class']})})})()`

export default defineConfig({
  srcDir,
  srcExclude: unpublished,
  outDir: `${stage}/dist`,
  cacheDir: `${stage}/cache`,
  base: '/somi/docs/',
  rewrites,
  title: 'SoMi',
  description: 'Guides for SoMi: a workflow plugin for coding agents on Claude Code and GitHub Copilot CLI.',
  head: [
    ['link', { rel: 'icon', href: '/somi/docs/somi-mark.svg', type: 'image/svg+xml' }],
    ['script', {}, themeFromOverview],
    ['script', {}, themeToOverview],
  ],
  themeConfig: {
    logo: '/somi-mark.svg',
    siteTitle: 'SoMi',
    // The overview page sits one level above the docs base, outside VitePress's router.
    logoLink: { link: '/somi/', target: '_self' },
    nav: [{ text: '← SoMi', link: '/../', target: '_self' }],
    search: { provider: 'local' },
    sidebar: [{ text: 'Guides', items: [...guides, ...unlisted].map(([md, text]) => ({ text, link: pageLink(md) })) }],
    outline: [2, 3],
    socialLinks: [{ icon: 'github', link: REPO }],
  },
  markdown: {
    // The docs use no raw HTML of their own, so a `<placeholder>` written in prose renders as
    // text instead of becoming an element or a Vue tag.
    html: false,
    // Heading ids follow GitHub's rule, so a link's #anchor lands here as it does there.
    anchor: { slugify: githubSlug },
    config: (md) => {
      // The docs are plain Markdown, not Vue templates: see escapeBraces. A fenced block is
      // already marked v-pre by VitePress; an indented one is not, so it is escaped here too.
      for (const rule of ['text', 'code_inline', 'code_block'] as const) {
        const render = md.renderer.rules[rule]!
        md.renderer.rules[rule] = (...args) => escapeBraces(render(...args))
      }
      md.core.ruler.push('outbound-and-rewritten-links', (state) => {
        // The source page's path relative to docs/, before any rewrite moved it.
        const page = relative(srcDir, state.env.realPath ?? state.env.path).split('\\').join('/')
        for (const block of state.tokens) {
          for (const token of block.children ?? []) {
            const href = token.type === 'link_open' ? token.attrGet('href') ?? '' : ''
            const url = href && rewriteLink(page, href, { unpublished, rewrites, isFolder })
            if (url) {
              token.attrSet('href', url)
            }
          }
        }
      })
      // VitePress labels a heading's permalink with the heading's Markdown source, backslash
      // escapes and code marks included. A screen reader should hear the heading as it reads.
      md.core.ruler.push('permalink-labels', (state) => {
        for (const block of state.tokens) {
          const permalink = block.children?.find((t) => t.type === 'link_open' && t.attrGet('class') === 'header-anchor')
          if (permalink) {
            const heading = block.children!.filter((t) => t.type === 'text' || t.type === 'code_inline').map((t) => t.content).join('').trim()
            permalink.attrSet('aria-label', `Permalink to "${heading}"`)
          }
        }
      })
    },
  },
})
