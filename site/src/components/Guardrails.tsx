import { HOOK_EVENTS, HOOKS } from '../content/hooks';
import { FACTS } from '../lib/facts';
import { Bullets, Section } from './ui';

const RULES = [
  ['00', 'Priorities: security, then correctness, then maintainability, then convenience. Honesty.'],
  ['10', 'SOLID in practice: one reason to change, small interfaces'],
  ['20', "Clean code: names that don't lie, comment the why"],
  ['30', 'Security floor (OWASP): validate at the boundary, parameterize sinks'],
  ['40', 'Testing, observability, dependencies'],
  ['50', 'Collaboration and reasoning craft'],
  ['99', "Your project's overrides"],
];

export function Guardrails() {
  const events = Object.keys(HOOK_EVENTS).filter((ev) => FACTS.hooks.some((h) => h.event === ev));
  return (
    <Section
      id="guardrails"
      kicker="Guardrails"
      title="Rules the model can't talk its way past"
      lede="Agents use judgment, but some limits are enforced by hooks. They run on Claude Code and on Copilot CLI (checked live on 1.0.103). The write guards fail closed: a write whose target can't be read is refused."
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
          <p>A compressed digest is always on. Each full rule file is read when its domain comes up. A project's own overrides win.</p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2">Rule file</th>
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
