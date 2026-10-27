import type { ReactNode } from 'react';
import type { Tier } from '../lib/resolver';

/** Renders the two inline marks content strings use: `code` and **bold** (which may contain `code`). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*.+?\*\*)/).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <b key={i} className="font-semibold text-ink">
            <Code text={part.slice(2, -2)} />
          </b>
        ) : (
          <Code key={i} text={part} />
        ),
      )}
    </>
  );
}

function Code({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? <code key={i}>{part.slice(1, -1)}</code> : part,
      )}
    </>
  );
}

interface SectionProps {
  id: string;
  kicker: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}

export function Section({ id, kicker, title, lede, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-b border-line px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">{kicker}</p>
        <h2 id={`${id}-title`} className="text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h2>
        {lede && <p className="mt-3 max-w-3xl text-lg text-muted">{lede}</p>}
        {children}
      </div>
    </section>
  );
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface p-5 shadow-sm ${className}`}>
      {title && <h3 className="mb-2 text-lg font-semibold">{title}</h3>}
      <div className="text-muted">{children}</div>
    </div>
  );
}

const TIER_CLASS: Record<Tier, string> = {
  low: 'bg-low-soft text-low',
  medium: 'bg-medium-soft text-medium',
  high: 'bg-high-soft text-high',
};

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`inline-block rounded-full px-2 py-px text-[0.7rem] font-bold normal-case tracking-normal ${TIER_CLASS[tier]}`}>{tier}</span>;
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-line">
      {items.map((t) => (
        <li key={t}>
          <Rich text={t} />
        </li>
      ))}
    </ul>
  );
}
