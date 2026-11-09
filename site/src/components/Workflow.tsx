import { COMMANDS } from '../content/commands';
import { Card, Rich, Section } from './ui';

const STAGES = [
  { step: 'Talk', text: 'Your agent holds the conversation on medium, as a bare agent would. Questions and follow-ups need no tool call.' },
  { step: 'Route', text: 'A ticket, large work or an unclear request gets its workflow from `somi_route`: debug, refactor, plan and more, each step with its tier.' },
  { step: 'Code', text: 'Written on medium, in the conversation. `/somi-deliver` runs large work in stages.' },
  { step: 'Quality gate', text: 'When a turn that changed code ends, anything over the limits goes back to be fixed.' },
  { step: 'Review', text: 'The real diff decides: no signal, no review. A signal gets one fresh reviewer, the security reviewer alone on a boundary.' },
];

export function Workflow() {
  return (
    <Section
      id="workflow"
      kicker="Workflow"
      title="Any request or ticket, routed for you"
      lede={<Rich text="Your agent stays in charge, and SoMi advises through tools that keep no workflow state. Small work stays small, and large work can run in stages, each on its tier." />}
    >
      <ol className="mt-10 grid gap-4 lg:grid-cols-5">
        {STAGES.map((s, i) => (
          <li key={s.step} className="rounded-xl border border-line bg-surface p-3.5 shadow-sm">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
              {i + 1} · {s.step}
            </div>
            <p className="text-sm text-muted">
              <Rich text={s.text} />
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {Object.entries(COMMANDS).map(([name, blurb]) => (
          <Card key={name} title={<code>{`/${name}`}</code>}>
            <p>{blurb}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
