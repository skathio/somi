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
});

describe('Rich', () => {
  it('renders code and bold, with code inside bold', () => {
    const out = renderToString(<Rich text="**Native `somi-*` agents.** then `x` and **y**" />);
    expect(out).toContain('<b class="font-semibold text-ink">Native <code>somi-*</code> agents.</b>');
    expect(out).toContain('<code>x</code>');
    expect(out).toContain('<b class="font-semibold text-ink">y</b>');
  });
});
