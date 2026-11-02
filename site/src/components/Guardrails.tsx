import { HOOK_EVENTS, HOOKS } from '../content/hooks';
import { FACTS } from '../lib/facts';
import { Bullets, Section } from './ui';

const RULES = [
  ['Priorities', 'Security, then correctness, then maintainability, then convenience.'],
  ['Honesty', 'Verify before claiming. Report failures as failures.'],
  ['Security floor', 'Validate at the boundary, parameterize sinks, fail closed.'],
  ['Tests', 'Behaviour, determinism, coverage that follows risk.'],
  ['Collaboration', 'Tradeoffs first. The maintainer decides direction.'],
];

export function Guardrails() {
  const events = Object.keys(HOOK_EVENTS).filter((ev) => FACTS.hooks.some((h) => h.event === ev));
  return (
    <Section
      id="guardrails"
      kicker="Guardrails"
      title="A sandbox is the boundary. Hooks are tripwires."
      lede="The OS sandbox stops an attacker. Hooks catch honest mistakes and tell someone to look. `somi doctor` proves the sandbox with the vendor probes."
    >
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-5 text-muted shadow-sm">
          {events.map((ev) => (
            <div key={ev} className="mt-4 first:mt-0">
              <p className="text-xs font-bold uppercase tracking-wider text-accent">{HOOK_EVENTS[ev]}</p>
              <Bullets items={FACTS.hooks.filter((h) => h.event === ev).map((h) => HOOKS[h.name])} />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-line bg-surface p-5 text-muted shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-ink">The ruleset</h3>
          <p>A digest under 150 lines arrives once per session. Your project rules stay in your own CLAUDE.md or AGENTS.md.</p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2">What it covers</th>
                </tr>
              </thead>
              <tbody>
                {RULES.map(([n, text]) => (
                  <tr key={n} className="border-t border-line">
                    <td className="px-3 py-2 font-mono">{n}</td>
                    <td className="px-3 py-2 text-ink">{text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            A request to weaken a security check is refused even when it is asked for explicitly. The agent names the tradeoff and
            offers another way to reach the goal.
          </p>
        </div>
      </div>
    </Section>
  );
}
