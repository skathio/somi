import { useCallback, useState } from 'react';
import { Header, type NavItem } from './components/Header';
import { Hero } from './components/Hero';
import { Roadmap } from './components/Roadmap';
import { Workflow } from './components/Workflow';
import { Cost } from './components/Cost';
import { Guardrails } from './components/Guardrails';
import { Loops } from './components/Loops';
import { Measured } from './components/Measured';
import { Install } from './components/Install';
import { FACTS } from './lib/facts';
import { toggleTheme, useActiveSection, useKeyboard } from './lib/navigation';

export const NAV: NavItem[] = [
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'cost', label: 'Cost system' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'loops', label: 'Loops' },
  { id: 'measured', label: 'Measured' },
  { id: 'install', label: 'Install' },
];

const SECTION_IDS = ['top', ...NAV.map((n) => n.id)];

export function App() {
  const [present, setPresent] = useState(false);
  const togglePresent = useCallback(() => setPresent((p) => !p), []);
  const active = useActiveSection(SECTION_IDS);
  useKeyboard(SECTION_IDS, togglePresent, toggleTheme);

  return (
    <div className={present ? 'present' : undefined}>
      <Header items={NAV} active={active} onPresent={togglePresent} onTheme={toggleTheme} />
      <main>
        <Hero />
        <Roadmap />
        <Workflow />
        <Cost />
        <Guardrails />
        <Loops />
        <Measured />
        <Install />
      </main>
      <footer className="px-4 pb-16 pt-10 text-sm text-muted">
        <div className="mx-auto max-w-6xl">
          Built from SoMi's CHANGELOG, docs and source at {FACTS.version}.{' '}
          <a className="text-accent" href="https://github.com/skathio/somi">github.com/skathio/somi</a> ·{' '}
          <a className="text-accent" href="https://github.com/skathio/somi/blob/main/CHANGELOG.md">CHANGELOG</a> ·{' '}
          <a className="text-accent" href="https://github.com/skathio/somi/blob/main/docs/USAGE-BENCHMARK.md">Usage benchmark</a>
        </div>
      </footer>
      <div aria-hidden="true" className="hint fixed bottom-4 right-4 hidden rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-muted shadow-sm lg:block">
        <Kbd>←</Kbd> <Kbd>→</Kbd> sections · <Kbd>P</Kbd> present · <Kbd>T</Kbd> theme
      </div>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1 font-mono">{children}</kbd>;
}
