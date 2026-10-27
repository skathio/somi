import icon from '../assets/somi-icon.png';

export interface NavItem {
  id: string;
  label: string;
}

interface HeaderProps {
  items: NavItem[];
  active: string;
  onPresent: () => void;
  onTheme: () => void;
}

const button =
  'rounded-md border border-line bg-surface px-2.5 py-1 text-sm text-ink transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent';

export function Header({ items, active, onPresent, onTheme }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-canvas/85 px-4 py-2.5 backdrop-blur">
      <a href="#top" className="flex shrink-0 items-center gap-2 font-bold tracking-wide text-ink no-underline">
        <img src={icon} alt="" width={28} height={28} className="h-7 w-7" />
        <span>
          So<span className="text-accent">Mi</span>
        </span>
      </a>
      <nav aria-label="Sections" className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            aria-current={active === it.id ? 'true' : undefined}
            className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-muted no-underline hover:bg-surface-2 hover:text-ink aria-[current]:bg-surface-2 aria-[current]:text-ink"
          >
            {it.label}
          </a>
        ))}
      </nav>
      <button type="button" onClick={onPresent} title="Present mode (P)" className={`${button} hidden sm:inline-block`}>
        Present
      </button>
      <button type="button" onClick={onTheme} title="Toggle theme (T)" aria-label="Toggle theme" className={button}>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="inline-block h-4 w-4 align-[-3px]">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
        </svg>
        <span className="ml-1 hidden sm:inline">Theme</span>
      </button>
    </header>
  );
}
