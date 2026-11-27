import { home_link } from '../../../.github/pages.json';

export interface NavItem {
  id: string;
  label: string;
}

interface HeaderProps {
  items: NavItem[];
  onPresent: () => void;
}

// <site-nav> is hashira's shared header (site-kit's site-nav.js, copied into /somi/_kit/ by the pages build):
// it renders the brand, the section links, Docs, its children as per-site extras, and the theme toggle, in
// the order every skathio site shares. The link back to the skathio homepage is the one in .github/pages.json,
// which the docs header shows too. React 19 passes these string props through as attributes. `scrollspy` marks
// the link of the section in view.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'site-nav': { scrollspy: ''; name: string; logo: string; docs: string; nav: string; home_link: string; children?: ReactNode };
    }
  }
}

// Sized like the kit's own toggle button (site-nav.js), so Present reads as part of the same bar.
const button =
  'cursor-pointer whitespace-nowrap rounded-lg border border-line bg-transparent px-3 py-1 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function Header({ items, onPresent }: HeaderProps) {
  const nav = JSON.stringify(items.map(({ id, label }) => ({ label, href: `#${id}` })));
  return (
    <site-nav scrollspy="" name="SoMi" logo="icon-192.png" docs="docs/" nav={nav} home_link={JSON.stringify(home_link)}>
      <button type="button" onClick={onPresent} title="Present mode (P)" className={`${button} hidden sm:inline-block`}>
        Present
      </button>
    </site-nav>
  );
}
