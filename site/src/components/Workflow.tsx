import { commandsIn, COMMANDS, type CommandGroup } from '../content/commands';
import { FACTS } from '../lib/facts';
import type { Tier } from '../lib/resolver';
import { Card, Rich, Section, TierBadge } from './ui';

interface Stage {
  step: string;
  group?: CommandGroup;
  agent?: string;
  text: string;
}

// Each stage's tier is its lead agent's default tier, read from the shipped table.
const STAGES: Stage[] = [
  { step: 'Front-load', group: 'front-load', agent: 'somi-designer', text: 'A new product, a brownfield feature, or a refactor too big for one diff.' },
  { step: 'Gate', text: 'The human checkpoint: decisions, a complexity map, and what execution does not need to research again.' },
  { step: 'Plan', group: 'plan', agent: 'somi-planner', text: 'Iterations sized to one reviewable change.' },
  { step: 'Code', group: 'code', agent: 'somi-coder', text: 'Implements against the plan under pass and diff caps.' },
  { step: 'Review', group: 'review', agent: 'somi-reviewer', text: 'Findings graded Blocker, Major, Minor or Nit; `/pr` writes the PR description.' },
];

const SIZES = [
  { name: 'trivial', text: 'One gate, no planning. A mechanical change.' },
  { name: 'small', text: 'One gate, then `/code-loop` on a brief-only work item. Work that handles untrusted input is at least `small` and is reviewed with the **security lens** on every pass.' },
  { name: 'full', text: 'The whole flow: front-load, brief gate, `/plan-loop`, `/code-loop`. Auth, crypto, secrets and PII are **always** `full`, and an override below that is refused.' },
];

const tierOf = (agent?: string): Tier | undefined => (agent ? FACTS.agentDefaults[agent] : undefined);

export function Workflow() {
  return (
    <Section
      id="workflow"
      kicker="Workflow"
      title="Expensive thinking once, cheap execution many times"
      lede={
        <Rich text="A high-tier agent compiles the decisions into a `brief.md`. You review it at one gate. Medium-tier agents then plan and code against the brief without researching again, and a fresh-context reviewer checks the result. Every artifact lands in `.somi/`, so work can stop today and resume next week." />
      }
    >
      <ol className="mt-10 grid gap-6 lg:grid-cols-5 lg:gap-0">
        {STAGES.map((s, i) => {
          const tier = tierOf(s.agent);
          const gate = !s.group;
          return (
            <li key={s.step} className="relative flex flex-col lg:px-2.5">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted">
                {i + 1} · {s.step} {tier && <TierBadge tier={tier} />}
              </div>
              <div
                className={`flex-1 rounded-xl p-3.5 shadow-sm ${
                  gate ? 'border-2 border-dashed border-gate bg-gate-soft' : 'border border-line bg-surface'
                }`}
              >
                {gate ? (
                  <span className="block font-mono font-semibold text-gate">brief.md</span>
                ) : (
                  commandsIn(s.group!).map((c) => (
                    <span key={c} className="block font-mono text-[0.92rem] font-semibold">
                      {`/${c}`}
                    </span>
                  ))
                )}
                <p className="mt-2 text-sm text-muted">
                  <Rich text={s.text} />
                </p>
              </div>
              {i < STAGES.length - 1 && (
                <span aria-hidden="true" className="absolute -bottom-6 left-1/2 text-muted lg:-right-2 lg:bottom-auto lg:left-auto lg:top-12">
                  <span className="lg:hidden">↓</span>
                  <span className="hidden lg:inline">→</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {commandsIn('pipeline').map((c) => (
          <Card key={c} title={<code>{`/${c}`}</code>}>
            {c === 'ship' ? (
              <p>The careful path: plan, code and review, stopping for your approval between each.</p>
            ) : (
              <p>
                <Rich text="The continuous path. It sizes the work, gates once at the brief, and then runs `/plan-loop` and `/code-loop` to completion under pass, diff, recurrence and optional time caps. It never runs with no human review at all." />
              </p>
            )}
          </Card>
        ))}
      </div>

      <h3 className="mt-10 text-lg font-semibold">
        Stage −1 of <code>/ship-loop</code>: size before spending
      </h3>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {SIZES.map((s) => (
          <div key={s.name} className={`rounded-xl border bg-surface p-4 ${s.name === 'full' ? 'border-high' : 'border-line'}`}>
            <h4 className="font-mono text-lg font-bold">{s.name}</h4>
            <p className="mt-1 text-sm text-muted">
              <Rich text={s.text} />
            </p>
          </div>
        ))}
      </div>

      <h3 className="mt-10 text-lg font-semibold">When the problem has a different shape</h3>
      <CommandGrid group="lane" />
      <h3 className="mt-8 text-lg font-semibold">Focused reviews</h3>
      <CommandGrid group="lens" />
    </Section>
  );
}

function CommandGrid({ group }: { group: CommandGroup }) {
  return (
    <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {commandsIn(group).map((c) => (
        <div key={c} className="rounded-lg border border-line bg-surface px-3 py-2.5">
          <span className="font-mono text-sm font-semibold">{`/${c}`}</span>
          <p className="text-sm text-muted">{COMMANDS[c].blurb}</p>
        </div>
      ))}
    </div>
  );
}
