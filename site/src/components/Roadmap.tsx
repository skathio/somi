import { ROADMAP as roadmap, type RoadmapEntry as Entry } from '../content/roadmap';
import { FACTS, formatDate, releaseDate } from '../lib/facts';
import { Bullets, Rich, Section } from './ui';

const ERAS = roadmap.eras;

export function Roadmap() {
  return (
    <Section
      id="roadmap"
      kicker="Roadmap"
      title="From three commands to a measured system"
      lede={roadmap.intro.replace('{commands}', String(FACTS.commands.length))}
    >
      <ol className="relative mt-10 border-l-2 border-line pl-6 sm:pl-7">
        {ERAS.map((era) => (
          <li key={era.label} className="mb-2">
            <p className="mb-2 mt-7 text-xs font-bold uppercase tracking-widest text-muted first:mt-0">{era.label}</p>
            <ol>
              {era.entries.map((e) => (
                <RoadmapEntry key={e.version} entry={e} />
              ))}
            </ol>
          </li>
        ))}
        <li>
          <p className="mb-2 mt-7 text-xs font-bold uppercase tracking-widest text-muted">Open after {FACTS.version}</p>
          <p className="max-w-3xl text-muted">
            <Rich text={roadmap.open} />
          </p>
        </li>
      </ol>
    </Section>
  );
}

function RoadmapEntry({ entry }: { entry: Entry }) {
  const now = entry.version === FACTS.version;
  const iso = releaseDate(entry.version);
  const dot = entry.major
    ? 'border-accent bg-accent'
    : 'border-muted bg-canvas';
  return (
    <li className="relative py-2.5">
      <span
        aria-hidden="true"
        className={`absolute top-[0.55rem] rounded-full border-2 ${dot} ${
          now ? '-left-[2.05rem] h-4 w-4 ring-4 ring-accent-soft sm:-left-[2.3rem]' : '-left-[1.95rem] h-3 w-3 sm:-left-[2.2rem]'
        }`}
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-mono font-bold">{entry.label ?? entry.version}</span>
        <span className="text-sm text-muted">{formatDate(iso, now || entry.version === '0.1.0')}</span>
        <span className="font-semibold">{entry.title}</span>
      </div>
      {entry.body && (
        <p className="mt-1 max-w-3xl text-muted">
          <Rich text={entry.body} />
        </p>
      )}
      {entry.highlights && (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {entry.highlights.map((h) => (
            <div key={h.title} className="rounded-xl border border-line bg-surface p-5 text-muted shadow-sm">
              <h3 className="text-lg font-semibold text-ink">{h.title}</h3>
              <Bullets items={h.items} />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
