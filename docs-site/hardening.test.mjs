// Defences beyond the request's own rules.
//
// The docs' theme toggle writes light or dark to the overview page's `somi-theme` key. In auto,
// VitePress also flips the page's class when the system theme changes; that flip is not the
// visitor's choice, so it must not be stored as one, or the overview page would stop following
// the system. The head scripts are taken from config.mts and run in a browser stub, in the order
// the page runs them, so these cases need no build.
//
// The README's guide links point at the docs site, which serves nothing until the site workflow
// deploys it. Each one carries the guide's source in docs/ beside it, which works on GitHub and
// in a clone from the first commit.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const docsSite = dirname(fileURLToPath(import.meta.url));
const root = join(docsSite, '..');
const read = (p) => readFileSync(p, 'utf8');
const KEY = 'somi-theme';
const VP_KEY = 'vitepress-theme-appearance';
const QUERY = '(prefers-color-scheme: dark)';

// ---------------------------------------------------------------- theme: a system change is not a choice

function headScript(name) {
  const m = read(join(docsSite, '.vitepress', 'config.mts')).match(new RegExp(`const ${name} = \`([^\`]*)\``));
  assert.ok(m, `config.mts defines no ${name}`);
  return m[1];
}

function makeStorage(initial = {}, blocked = false) {
  const store = new Map(Object.entries(initial));
  const guard = () => { if (blocked) { throw new Error('SecurityError: storage is blocked'); } };
  return {
    getItem: (k) => { guard(); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { guard(); store.set(k, String(v)); },
    removeItem: (k) => { guard(); store.delete(k); },
  };
}

// A browser stub. `media` is 'modern' (addEventListener), 'legacy' (addListener only), 'missing'
// (no matchMedia) or 'throws'. Timers queue until runTask; observer records are delivered by hand,
// as the microtask after a class change.
function makeBrowser({ storage, prefersDark = false, media = 'modern' }) {
  const classes = new Set();
  const docEl = { classList: { contains: (c) => classes.has(c), toggle: (c, on) => { classes[on ? 'add' : 'delete'](c); } } };
  const state = { prefersDark, loadListeners: [], mediaListeners: [], timers: [], observers: [] };
  const mql = (query) => {
    const list = {
      get matches() { return query === QUERY && state.prefersDark; },
      media: query,
    };
    const add = (fn) => { if (query === QUERY) { state.mediaListeners.push(fn); } };
    if (media === 'modern') { list.addEventListener = (type, fn) => { if (type === 'change') { add(fn); } }; }
    list.addListener = add;
    return list;
  };
  const sandbox = {
    document: { documentElement: docEl, addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') { state.loadListeners.push(fn); } } },
    setTimeout: (fn) => { state.timers.push(fn); },
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe(target) { state.observers.push({ cb: this.cb, target }); } disconnect() {} },
  };
  if (media === 'modern' || media === 'legacy') { sandbox.matchMedia = mql; }
  if (media === 'throws') { sandbox.matchMedia = () => { throw new Error('matchMedia is not available'); }; }
  Object.defineProperty(sandbox, 'localStorage', {
    get: () => { if (storage === 'throws') { throw new Error('SecurityError: storage is blocked'); } return storage; },
  });
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox, docEl, classes, state };
}

// Loads a docs page: the head scripts in order, then VitePress's app, which reads its own key and
// listens for system changes after the head scripts ran, then DOMContentLoaded.
function loadDocs(opts) {
  const b = makeBrowser(opts);
  for (const s of [headScript('themeFromOverview'), headScript('themeToOverview')]) { vm.runInContext(s, b.sandbox); }
  const ownListenersAtHead = b.state.mediaListeners.length;
  const vpMode = () => { try { return opts.storage.getItem(VP_KEY) ?? 'auto'; } catch { return 'auto'; } };
  const applyClass = () => b.docEl.classList.toggle('dark', vpMode() === 'auto' ? b.state.prefersDark : vpMode() === 'dark');
  applyClass();
  const notifyObservers = () => {
    for (const o of b.state.observers.filter((x) => x.target === b.docEl)) { o.cb([{ type: 'attributes', attributeName: 'class' }]); }
  };
  // VitePress's own system listener: in auto it flips the class, and the observer hears of it
  // in the microtask that follows.
  if (opts.media !== 'missing' && opts.media !== 'throws') {
    b.state.mediaListeners.push(() => { if (vpMode() === 'auto') { applyClass(); } });
  }
  for (const fn of b.state.loadListeners) { fn(); }
  return {
    ownListenersAtHead,
    isDark: () => b.classes.has('dark'),
    systemChange(isDark) {
      b.state.prefersDark = isDark;
      for (const fn of [...b.state.mediaListeners]) { fn({ matches: isDark, media: QUERY }); }
      notifyObservers();
    },
    runTask() { const due = b.state.timers.splice(0); for (const fn of due) { fn(); } },
    // What VitePress's appearance toggle does on a click: store its own key and flip the class.
    toggle(isDark) {
      try { opts.storage.setItem(VP_KEY, isDark ? 'dark' : 'light'); } catch { /* blocked storage */ }
      b.docEl.classList.toggle('dark', isDark);
      notifyObservers();
    },
  };
}

describe('a system theme change is not stored as the visitor\'s choice', () => {
  test('with no stored theme, a system change flips the docs but leaves somi-theme unset', () => {
    for (const start of [false, true]) {
      const storage = makeStorage();
      const page = loadDocs({ storage, prefersDark: start });
      page.systemChange(!start);
      assert.equal(page.isDark(), !start, 'the docs did not follow the system');
      assert.equal(storage.getItem(KEY), null, `system dark ${start} -> ${!start}`);
      page.runTask();
      page.systemChange(start);
      assert.equal(storage.getItem(KEY), null, `system dark ${!start} -> ${start}`);
    }
  });

  test('any other stored value stays as it was through a system change', () => {
    for (const value of ['sepia', 'auto', '', 'DARK']) {
      const storage = makeStorage({ [KEY]: value });
      const page = loadDocs({ storage, prefersDark: false });
      page.systemChange(true);
      assert.equal(storage.getItem(KEY), value, JSON.stringify(value));
    }
  });

  test('the system listener is registered by the head script, before VitePress registers its own', () => {
    const page = loadDocs({ storage: makeStorage(), prefersDark: false });
    assert.equal(page.ownListenersAtHead, 1, 'the head script registers no prefers-color-scheme listener');
  });

  test('after the next task, the visitor\'s toggle is stored again', () => {
    const storage = makeStorage();
    const page = loadDocs({ storage, prefersDark: false });
    page.systemChange(true);
    page.runTask();
    page.toggle(false);
    assert.equal(storage.getItem(KEY), 'light');
    page.toggle(true);
    assert.equal(storage.getItem(KEY), 'dark');
  });

  test('a host with only the older addListener gets the same guard', () => {
    const storage = makeStorage();
    const page = loadDocs({ storage, prefersDark: false, media: 'legacy' });
    assert.equal(page.ownListenersAtHead, 1, 'no listener through addListener');
    page.systemChange(true);
    assert.equal(storage.getItem(KEY), null);
  });

  test('without a usable matchMedia the scripts throw nothing and the toggle is still stored', () => {
    for (const media of ['missing', 'throws']) {
      const storage = makeStorage();
      let page;
      assert.doesNotThrow(() => { page = loadDocs({ storage, media }); }, media);
      page.toggle(true);
      assert.equal(storage.getItem(KEY), 'dark', media);
    }
  });

  test('blocked storage through a system change throws nothing', () => {
    for (const storage of [makeStorage({}, true), 'throws']) {
      const page = loadDocs({ storage, prefersDark: false });
      assert.doesNotThrow(() => { page.systemChange(true); page.runTask(); page.toggle(false); });
    }
  });
});

// ---------------------------------------------------------------- README: each guide link has its source beside it

const DOCS_SITE = 'https://skathio.github.io/somi/docs/';
const REPLACED = ['Use', 'Set your tiers', 'Set your quality limits', 'Connect other plugins with shards', 'Turn on the sandbox'];

// The README's sections, heading to the non-blank lines under it, with fenced blocks left out.
function readmeSections() {
  const prose = read(join(root, 'README.md')).replace(/^```[\s\S]*?^```$/gm, '');
  const sections = new Map();
  for (const part of prose.split(/^## /m).slice(1)) {
    const [heading, ...body] = part.split('\n');
    sections.set(heading.trim(), body.filter((l) => l.trim()));
  }
  return sections;
}

// The docs/ source of a docs-site URL, with its anchor: /somi/docs/ is getting-started.md.
function sourceOf(url) {
  const [path, anchor = ''] = url.slice(DOCS_SITE.length).split('#');
  const page = path.replace(/\.html$/, '').replace(/\/$/, '') || 'getting-started';
  return `docs/${page}.md${anchor ? `#${anchor}` : ''}`;
}

describe('the README\'s guide links work before the docs site is deployed', () => {
  test('each docs-site link in a replaced section has its docs/ source, with the anchor, beside it', () => {
    const sections = readmeSections();
    const lines = REPLACED.flatMap((name) => (sections.get(name) ?? []).map((line) => [name, line]));
    const links = lines.flatMap(([name, line]) => {
      const all = [...line.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
      return all.filter((h) => h.startsWith(DOCS_SITE)).map((url) => ({ name, url, beside: all }));
    });
    assert.ok(links.length > 0, 'the replaced sections link no guide on the docs site');
    const missing = links.filter((l) => !l.beside.includes(sourceOf(l.url))).map((l) => `${l.name}: ${l.url} has no ${sourceOf(l.url)}`);
    assert.deepEqual(missing, []);
  });

  test('every docs/ source the README links exists, and its anchor is a heading there', () => {
    const md = read(join(root, 'README.md'));
    const slug = (h) => h.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
    const broken = [...md.matchAll(/\]\((docs\/[^)\s#]+\.md)(?:#([^)\s]+))?\)/g)].filter(([, file, anchor]) => {
      if (!existsSync(join(root, file))) { return true; }
      const ids = read(join(root, file)).split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, '')));
      return Boolean(anchor) && !ids.includes(anchor);
    }).map((m) => m[0]);
    assert.deepEqual(broken, []);
  });
});
