import { useEffect, useState } from 'react';

/** The id of the section whose top has scrolled past the header, updated on scroll. */
export function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const update = () => setActive(currentSection(ids, window.scrollY + 80));
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [ids]);
  return active;
}

function currentSection(ids: string[], y: number): string {
  let current = ids[0];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.offsetTop <= y) current = id;
  }
  return current;
}

/** ←/→ (also PageUp/PageDown, j/k) step between sections; P toggles present mode; T toggles the theme. */
export function useKeyboard(ids: string[], onPresent: () => void, onTheme: () => void): void {
  useEffect(() => {
    const step = (d: number) => {
      const i = ids.indexOf(currentSection(ids, window.scrollY + 80));
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + d))];
      document.getElementById(next)?.scrollIntoView({ behavior: 'smooth' });
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['ArrowRight', 'PageDown', 'j'].includes(e.key)) {
        e.preventDefault();
        step(1);
      } else if (['ArrowLeft', 'PageUp', 'k'].includes(e.key)) {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'p' || e.key === 'P') onPresent();
      else if (e.key === 't' || e.key === 'T') onTheme();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids, onPresent, onTheme]);
}

/** Flips the theme index.html set before first paint and remembers it when storage is available. */
export function toggleTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('somi-theme', root.dataset.theme);
  } catch {
    // Storage blocked (private window, previews): the toggle still works for this visit.
  }
}
