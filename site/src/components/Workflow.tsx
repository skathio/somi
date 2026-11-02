import { COMMANDS } from '../content/commands';
import { Card, Rich, Section } from './ui';

const STAGES = [
  { step: 'Ask once', text: 'Only if the request itself names an expensive-to-reverse choice: schema, public API, storage, auth model.' },
  { step: 'Code', text: 'In the main thread, the way a bare agent would.' },
  { step: 'Check', text: '`somi check` in under 60 seconds: lint, gates, affected tests.' },
  { step: 'Read the diff', text: 'Signals come from what actually changed, not from a forecast.' },
  { step: 'Review or close', text: 'No signal, no review. A signal gets one fresh reviewer.' },
];

export function Workflow() {
  return (
    <Section
      id="workflow"
      kicker="Workflow"
      title="Any request or ticket, routed for you"
      lede={<Rich text="A thin coordinator asks a step engine what to do next, and workers run on the cheapest tier that fits. Small work stays small, and large work gets milestones with fresh context." />}
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
