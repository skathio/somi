import { MEASURED } from '../content/measured';
import { Card, Rich, Section } from './ui';

function Verdict({ text }: { text: string }) {
  const ok = text === 'clear' || text === 'better';
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-px text-xs font-bold ${ok ? 'bg-low-soft text-low' : 'bg-surface-2 text-muted'}`}>
      {text}
    </span>
  );
}

export function Measured() {
  return (
    <Section
      id="measured"
      kicker="Measured, not claimed"
      title="A sealed rule decides what counts as a win"
      lede="The usage benchmark has three layers: L0 measures the instruction bytes injected, L1 times local hooks and scripts, and L2 runs paired live draws with and without SoMi. A rule written before the measurement turns two baselines into better, worse or inconclusive (ratio of medians, 90% bootstrap interval, quality guard)."
    >
      <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-2.5">Comparison ({MEASURED.setup})</th>
              <th className="px-4 py-2.5">Cost</th>
              <th className="px-4 py-2.5">Time</th>
              <th className="px-4 py-2.5">Quality guard</th>
            </tr>
          </thead>
          <tbody>
            {MEASURED.comparisons.map((c) => (
              <tr key={c.label} className="border-t border-line">
                <td className="px-4 py-2.5">{c.label}</td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                  {c.cost} <Verdict text={c.costVerdict} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                  {c.time} <Verdict text={c.timeVerdict} />
                </td>
                <td className="px-4 py-2.5">
                  <Verdict text={c.guard} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {MEASURED.highlights.map((h) => (
          <Card key={h.title} title={h.title}>
            <p>
              <Rich text={h.text} />
            </p>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">{MEASURED.note}</p>
    </Section>
  );
}
