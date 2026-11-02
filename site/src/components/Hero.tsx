import icon from '../assets/somi-icon.png';
import { FACTS, monthsSpanned } from '../lib/facts';

export function Hero() {
  const months = monthsSpanned(FACTS.releases);
  const stats = [
    { n: FACTS.commands.length, label: 'slash commands' },
    { n: FACTS.agents.length, label: 'agents' },
    { n: FACTS.skills.length, label: 'skills' },
    { n: FACTS.hooks.length, label: 'guardrail hooks' },
    { n: FACTS.releases.length, label: `releases in ${months} month${months === 1 ? '' : 's'}` },
  ];
  const pills = ['Zero-dependency Node runtime', 'Linux · macOS · WSL2', 'MIT'];

  return (
    <section id="top" aria-label="Introduction" className="border-b border-line px-4 pb-16 pt-16 sm:pb-20 sm:pt-24">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col-reverse gap-6 md:flex-row md:items-center md:justify-between md:gap-10">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">
              A small kernel for coding agents · {FACTS.version}
            </p>
            <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              So<span className="text-accent">Mi</span>: say what you want, and it runs the right workflow.
            </h1>
            <p className="mt-5 max-w-3xl text-lg text-muted sm:text-xl">
              A plugin for Claude Code and GitHub Copilot CLI. The agent codes in the main thread. A deterministic check runs before each commit, and a fresh reviewer runs only when the real diff calls for one. Tools write all state, and the OS sandbox is the security boundary.
            </p>
          </div>
          <img
            src={icon}
            alt="The SoMi icon"
            width={240}
            height={240}
            className="h-24 w-24 shrink-0 drop-shadow-[0_0_24px_rgba(200,22,26,0.35)] sm:h-32 sm:w-32 md:h-52 md:w-52 lg:h-60 lg:w-60"
          />
        </div>
        <dl className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <dt className="sr-only">{s.label}</dt>
              <dd className="text-3xl font-bold leading-tight">{s.n}</dd>
              <dd className="text-sm text-muted">{s.label}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          {['Claude Code', 'GitHub Copilot CLI'].map((p) => (
            <span key={p} className="rounded-full border border-accent bg-accent-soft px-3 py-1 text-sm text-accent">
              {p}
            </span>
          ))}
          {pills.map((p) => (
            <span key={p} className="rounded-full border border-line bg-surface px-3 py-1 text-sm">
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
