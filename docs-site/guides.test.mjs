// Rules for the seven user guides in docs/ and the shortened README: each guide
// opens with one # H1 and has no front matter, covers what the request lists for
// it, takes its names from the code and the commands' own files, and links only
// to pages and headings that exist. The README keeps its intro, How it works,
// Install and Use, sends the four long sections to the docs site, and its Docs
// section links the docs site first. None of these tests needs the docs build.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARD_STEPS } from '../scripts/lib/shards.mjs';
import { TIERS } from '../scripts/lib/tiers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(root, 'docs');
const commandsDir = join(root, 'commands');
const DOCS_SITE = 'https://skathio.github.io/somi/docs/';
const GUIDES = ['getting-started.md', 'workflows.md', 'commands.md', 'configuration.md', 'hosts.md', 'shards.md', 'sandbox.md'];

const read = (path) => readFileSync(path, 'utf8');
const guide = (name) => read(join(docsDir, name));
const docsPages = () => readdirSync(docsDir).filter((f) => f.endsWith('.md'));
const commandNames = () => readdirSync(commandsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();

// Markdown lines outside fenced code blocks, so a # inside a shell sample is not a heading.
const closes = (mark, fence) => Boolean(mark) && mark[0] === fence[0] && mark.length >= fence.length;

function proseLines(md) {
  const out = [];
  let fence = null;
  for (const line of md.split(/\r?\n/)) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) { fence = closes(mark, fence) ? null : fence; continue; }
    if (mark) { fence = mark; continue; }
    out.push(line);
  }
  return out;
}

const headings = (md, level) => proseLines(md).filter((l) => l.startsWith(`${'#'.repeat(level)} `)).map((l) => l.slice(level + 1).trim());

// The bodies of fenced blocks whose info string is the given language.
function fencedBlocks(md, lang) {
  const re = new RegExp(String.raw`^ {0,3}(\`{3,}|~{3,})${lang}[^\n]*\n([\s\S]*?)\n {0,3}\1[ \t]*$`, 'gm');
  return [...md.matchAll(re)].map((m) => m[2]);
}

// GitHub's heading id: the text as rendered, lower case, punctuation dropped, spaces to hyphens, repeats numbered.
function githubSlugs(md) {
  const seen = new Map();
  return proseLines(md).filter((l) => /^#{1,6} /.test(l)).map((l) => {
    const text = l.replace(/^#{1,6} /, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').trim();
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  });
}

const markdownLinks = (md) => [...proseLines(md).join('\n').matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);

function firstContentLine(md) {
  return md.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
}

// The README's sections: heading to the non-blank lines under it.
function readmeSections() {
  const sections = new Map();
  let current = '';
  for (const line of proseLines(read(join(root, 'README.md')))) {
    const h = line.match(/^## (.+)$/);
    if (h) { current = h[1].trim(); sections.set(current, []); continue; }
    if (line.trim() && sections.has(current)) sections.get(current).push(line);
  }
  return sections;
}

const includesAll = (text, needles) => needles.filter((n) => !text.includes(n));

describe('the seven guides', () => {
  test('each guide exists in docs/', () => {
    const missing = GUIDES.filter((g) => !existsSync(join(docsDir, g)));
    assert.deepEqual(missing, [], `missing guides: ${missing.join(', ')}`);
  });

  for (const name of GUIDES) {
    test(`${name} opens with one # H1 and carries no front matter`, () => {
      const md = guide(name);
      assert.doesNotMatch(md, /^﻿?---\s*\n/, 'front matter');
      assert.match(firstContentLine(md), /^# \S/, 'the first line is not a # H1');
      assert.equal(headings(md, 1).length, 1, 'more than one # H1');
    });
  }

  test('no docs/*.md page carries front matter, so it reads on GitHub as on the site', () => {
    const withFrontMatter = docsPages().filter((f) => /^﻿?---\s*\n/.test(guide(f)));
    assert.deepEqual(withFrontMatter, []);
  });
});

describe('guide content', () => {
  test('getting-started.md covers install on both hosts, the agent flag, somi launch and where to go next', () => {
    const md = guide('getting-started.md');
    const absent = includesAll(md, [
      '/plugin marketplace add', '/plugin install somi@somi', 'copilot plugin marketplace add', 'copilot plugin install somi@somi',
      'claude --agent somi:somi', 'copilot --agent somi:somi', 'somi launch',
    ]);
    assert.deepEqual(absent, []);
    const next = markdownLinks(md).filter((href) => /^(\.\/)?[\w-]+\.md(#|$)/.test(href));
    assert.ok(next.length > 0, 'getting-started.md links no other guide to go to next');
  });

  test('workflows.md covers somi_route, /somi-brief, /somi-deliver and its stages, the quality gate and somi_pr', () => {
    const md = guide('workflows.md');
    assert.deepEqual(includesAll(md, ['somi_route', '/somi-brief', '/somi-deliver', 'somi_pr']), []);
    assert.match(md, /quality gate/i);
    assert.match(md, /scout/i, "/somi-deliver's stages start with a scout");
    assert.match(md, /milestone/i, "/somi-deliver's stages plan milestones");
    assert.match(md, /review/i);
  });

  test('configuration.md covers the tiers, the security tier, the quality level and every quality key the request names', () => {
    const md = guide('configuration.md');
    assert.deepEqual(includesAll(md, ['main', ...TIERS, 'security_tier', 'quality.commit', 'quality.pr', 'quality.repo', 'forbid_imports', 'timeout_seconds']), []);
    assert.match(md, /quality\.level|"level"/, 'the quality level');
    assert.match(md, /stricter/i, "a project's config can only make things stricter");
  });

  test('hosts.md covers command naming, /experimental, Auto, VS Code and .github/hooks/somi.json', () => {
    const md = guide('hosts.md');
    assert.deepEqual(includesAll(md, ['/somi:somi-', '/experimental', 'Auto', 'VS Code', '.github/hooks/somi.json']), []);
  });

  test('shards.md names each of the four steps the code defines, somi slot, write mode and held shards', () => {
    const md = guide('shards.md');
    assert.equal(SHARD_STEPS.length, 4);
    assert.deepEqual(includesAll(md, [...SHARD_STEPS, 'somi slot']), []);
    assert.match(md, /write/i);
    assert.match(md, /held/i);
    assert.match(md, /data/i, 'shard output is treated as data');
  });

  test('sandbox.md is "Sandbox and trust" and covers somi doctor, --profile, hooks as tripwires and the trust model', () => {
    const md = guide('sandbox.md');
    assert.deepEqual(headings(md, 1), ['Sandbox and trust']);
    assert.deepEqual(includesAll(md, ['somi doctor', '--profile']), []);
    assert.match(md, /hook/i);
    assert.match(md, /tripwire/i);
    assert.ok(markdownLinks(md).some((href) => /^(\.\/)?ARCHITECTURE\.md#trust-model$/.test(href)), 'no link to ARCHITECTURE.md#trust-model');
  });
});

describe('commands.md', () => {
  const named = (md) => [...md.matchAll(/(?<![\w./-])\/(?:somi:)?(somi(?:-[a-z]+)*)\b/g)].map((m) => m[1]);

  test('the command reader finds a plain, a namespaced and a bare command and skips paths and URLs', () => {
    const sample = '`/somi-brief` and /somi:somi-review and `/somi doctor`, not commands/somi-x.md, .github/hooks/somi.json or https://github.com/skathio/somi';
    assert.deepEqual(named(sample), ['somi-brief', 'somi-review', 'somi']);
  });

  test('commands.md names every file in commands/', () => {
    const mentioned = new Set(named(guide('commands.md')));
    const absent = commandNames().filter((c) => !mentioned.has(c));
    assert.deepEqual(absent, [], `commands.md leaves out: ${absent.join(', ')}`);
  });

  test('commands.md names no command that does not exist', () => {
    const real = new Set(commandNames());
    const invented = [...new Set(named(guide('commands.md')))].filter((c) => !real.has(c));
    assert.deepEqual(invented, [], `commands.md names: ${invented.join(', ')}`);
  });

  test("commands.md covers each command /somi takes, as its own file's description lists them", () => {
    const description = read(join(commandsDir, 'somi.md')).match(/^description: "[^"]*a command: ([^."]+)/m);
    assert.ok(description, "commands/somi.md's description lists its commands");
    const subcommands = description[1].split(/,\s*|\s+or\s+/).map((s) => s.trim()).filter(Boolean);
    assert.ok(subcommands.length > 1);
    const md = guide('commands.md');
    const absent = subcommands.filter((s) => !new RegExp(String.raw`\b${s}\b`).test(md));
    assert.deepEqual(absent, [], `commands.md leaves out /somi ${absent.join(', /somi ')}`);
  });
});

describe('configuration.md json blocks', () => {
  const unparsed = (md) => fencedBlocks(md, 'json').filter((body) => {
    try { JSON.parse(body); return false; } catch { return true; }
  });

  test('the block check finds no block, one good block, and a bad one among good ones', () => {
    assert.deepEqual(unparsed('no code here\n'), []);
    assert.deepEqual(unparsed('```json\n{ "a": 1 }\n```\n'), []);
    assert.equal(unparsed('```json\n{ "a": 1 }\n```\n\n```json\n{ "a": 1, }\n```\n\n```json\n[]\n```\n').length, 1);
  });

  test('every json code block in configuration.md parses', () => {
    const bad = unparsed(guide('configuration.md'));
    assert.deepEqual(bad, [], `blocks that do not parse:\n${bad.join('\n---\n')}`);
  });
});

describe('links from the guides', () => {
  test('the slug rule follows GitHub: punctuation and code marks dropped, case lowered, repeats numbered', () => {
    assert.deepEqual(githubSlugs('# Trust model\n## `quality.pr` and *more*!\n## Trust model\n'), ['trust-model', 'qualitypr-and-more', 'trust-model-1']);
  });

  test('every relative link from a guide to a docs/ page names a page and a heading that exist', () => {
    const DOC_LINK = /^(?:\.\/)?([\w.-]+\.md)(?:#([^?]*))?(?:\?.*)?$/;
    const resolves = (href) => {
      const [, page, anchor] = href.match(DOC_LINK);
      const target = join(docsDir, page);
      return existsSync(target) && (!anchor || githubSlugs(read(target)).includes(decodeURIComponent(anchor)));
    };
    const broken = GUIDES.flatMap((name) => markdownLinks(guide(name))
      .filter((href) => DOC_LINK.test(href) && !resolves(href))
      .map((href) => `${name}: ${href}`));
    assert.deepEqual(broken, []);
  });

  test('every in-page anchor in a guide names one of its headings', () => {
    const broken = GUIDES.flatMap((name) => {
      const slugs = githubSlugs(guide(name));
      return markdownLinks(guide(name)).filter((h) => h.startsWith('#') && !slugs.includes(decodeURIComponent(h.slice(1)))).map((h) => `${name}: ${h}`);
    });
    assert.deepEqual(broken, []);
  });
});

describe('the README', () => {
  test('keeps its intro, How it works, Install and Use', () => {
    const md = read(join(root, 'README.md'));
    const intro = proseLines(md).slice(1, proseLines(md).findIndex((l) => l.startsWith('## '))).join('').trim();
    assert.ok(intro.length > 0, 'the intro is gone');
    const sections = readmeSections();
    const absent = ['How it works', 'Install', 'Use'].filter((s) => !sections.has(s));
    assert.deepEqual(absent, []);
    assert.deepEqual(includesAll(md, ['/plugin install somi@somi', 'copilot plugin install somi@somi']), [], 'Install covers both hosts');
  });

  test('the four long sections are each one line that links the docs site, or gone', () => {
    const sections = readmeSections();
    for (const name of ['Set your tiers', 'Set your quality limits', 'Connect other plugins with shards', 'Turn on the sandbox']) {
      const body = sections.get(name);
      if (!body) continue;
      assert.equal(body.length, 1, `${name} is ${body.length} lines`);
      assert.ok(body[0].includes(`](${DOCS_SITE}`), `${name} does not link the docs site`);
    }
    const md = read(join(root, 'README.md'));
    assert.ok(md.includes(`](${DOCS_SITE}`), 'the README links no guide on the docs site');
  });

  test('the shortened README drops the long samples the guides now hold', () => {
    const md = read(join(root, 'README.md'));
    assert.doesNotMatch(md, /somi slot work-item\.start/, 'the shard sample');
    assert.doesNotMatch(md, /"forbid_imports"/, 'the forbid_imports sample');
    assert.doesNotMatch(md, /"timeout_seconds"/, 'the timeout sample');
  });

  test('every docs-site link in the README names a guide that exists in docs/', () => {
    const md = read(join(root, 'README.md'));
    const pages = [...md.matchAll(/\]\((https:\/\/skathio\.github\.io\/somi\/docs\/[^)\s]*)\)/g)].map((m) => m[1]);
    const missing = pages.filter((url) => {
      const page = url.slice(DOCS_SITE.length).replace(/[#?].*$/, '').replace(/\.html$/, '').replace(/\/$/, '');
      return !existsSync(join(docsDir, `${page || 'getting-started'}.md`));
    });
    assert.deepEqual(missing, []);
  });

  test('its Docs section links the docs site first and keeps VERSIONING.md and CHANGELOG.md on GitHub', () => {
    const docs = readmeSections().get('Docs');
    assert.ok(docs, 'no Docs section');
    const links = docs.flatMap((l) => [...l.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]));
    assert.ok(links.length > 0, 'the Docs section has no link');
    assert.ok(links[0].startsWith(DOCS_SITE), `the first Docs link is ${links[0]}`);
    const onGitHub = (file) => links.some((h) => h === file || h === `https://github.com/skathio/somi/blob/main/${file}`);
    assert.ok(onGitHub('docs/VERSIONING.md'), 'VERSIONING.md');
    assert.ok(onGitHub('CHANGELOG.md'), 'CHANGELOG.md');
  });
});
