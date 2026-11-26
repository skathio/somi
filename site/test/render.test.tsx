import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App, NAV } from '../src/App';
import { Rich } from '../src/components/ui';
import { FACTS } from '../src/lib/facts';

const html = renderToString(<App />);
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

describe('the rendered page', () => {
  it('has every section the navigation points to', () => {
    for (const { id } of NAV) expect(ids, id).toContain(id);
    expect(ids).toContain('top');
  });

  it('has no in-page link or label reference that resolves to nothing', () => {
    for (const m of html.matchAll(/\shref="#([^"]*)"/g)) expect(ids, `#${m[1]}`).toContain(m[1]);
    for (const m of html.matchAll(/\saria-labelledby="([^"]+)"/g)) expect(ids, m[1]).toContain(m[1]);
  });

  it('lets a card shrink below its widest code line, so a long command scrolls in its block instead of widening the page on a phone', () => {
    // A card is a grid item, and a grid item without min-w-0 is as wide as its longest unbroken line: the install commands made the page
    // 613 px wide at 360. jsdom has no layout, so this checks the class that fixes it on every card that holds a code block.
    const cards = [...html.matchAll(/<div class="([^"]*rounded-xl border border-line bg-surface[^"]*)"/g)];
    const withCode = cards.filter((m, i) => html.slice(m.index, cards[i + 1]?.index ?? html.length).includes('<pre'));
    expect(withCode.length).toBeGreaterThan(0);
    for (const m of withCode) expect(m[1].split(/\s+/), m[1]).toContain('min-w-0');
  });

  it('has no duplicate ids', () => {
    const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(all.length).toBe(new Set(all).size);
  });

  it('states the current version and every command', () => {
    expect(html).toContain(FACTS.version);
    for (const c of FACTS.commands) expect(html, c).toContain(`/${c}`);
  });

  it('links out only to the project', () => {
    for (const m of html.matchAll(/\shref="(https?:[^"]+)"/g)) expect(m[1]).toMatch(/^https:\/\/github\.com\/skathio\/somi\b/);
  });

  it('links the docs site, which is built under the same Pages base', () => {
    const local = [...html.matchAll(/<a\b[^>]*\shref="(\/[^"]*)"/g)].map((m) => m[1]);
    expect(local).toContain('/somi/docs/');
    expect(local).toContain('/somi/docs/BENCHMARK.html');
    for (const href of local) expect(href).toMatch(/^\/somi\/docs\//);
  });
});

describe('Rich', () => {
  it('renders code and bold, with code inside bold', () => {
    const out = renderToString(<Rich text="**Native `somi-*` agents.** then `x` and **y**" />);
    expect(out).toContain('<b class="font-semibold text-ink">Native <code>somi-*</code> agents.</b>');
    expect(out).toContain('<code>x</code>');
    expect(out).toContain('<b class="font-semibold text-ink">y</b>');
  });
});
