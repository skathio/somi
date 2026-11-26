import { useEffect } from 'react';

function currentSection(ids: string[], y: number): string {
  let current = ids[0];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.offsetTop <= y) current = id;
  }
  return current;
}

/** ←/→ (also PageUp/PageDown, j/k) step between sections; P toggles present mode; T steps the theme. */
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

declare global {
  interface Window {
    /** Set by hashira's site-kit theme.js, loaded in <head>; absent when the kit did not load (vite dev). */
    siteTheme?: { next: () => string };
  }
}

/** Steps the kit's theme (auto, light, dark), the same as its toggle in <site-nav>, which also stores it. */
export function toggleTheme(): void {
  window.siteTheme?.next();
}
