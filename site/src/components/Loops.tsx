import { Bullets, Card, Rich, Section } from './ui';

const EXITS = [
  ['2', 'The pass cap is reached'],
  ['3', 'The cumulative weighted diff is over its cap (files outside the declared scope count double)'],
  ['4', 'The `/ship-loop` wall-time budget is spent'],
  ['5', 'A finding recurs on consecutive passes: the coder and reviewer disagree, so a human decides'],
];

export function Loops() {
  return (
    <Section
      id="loops"
      kicker="Deterministic loop core"
      title="The model decides; scripts do the counting"
      lede={
        <Rich text="The bounded loops' hard gates live in `somi-loop` and the findings ledger, not in the model's memory. Their state is durable, so a loop resumes after a session dies." />
      }
    >
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card title="Gates as exit codes">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2">Exit</th>
                  <th className="px-3 py-2">Stops when</th>
                </tr>
              </thead>
              <tbody>
                {EXITS.map(([code, text]) => (
                  <tr key={code} className="border-t border-line">
                    <td className="px-3 py-2 font-mono">{code}</td>
                    <td className="px-3 py-2 text-ink">
                      <Rich text={text} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Added in 4.0.0">
          <Bullets
            items={[
              '**Delta re-review:** from pass 2, the reviewer reads only the change since the last reviewed tree, plus the open findings. Pass 1, the last pass and the security lens are always reviewed in full.',
              '**Dispatch record:** each agent start is stored with its tier, model and whether the model was enforced, as computed by the resolver rather than claimed by the caller.',
              '**Findings ledger:** stable `F-n` ids, keyed to a file and symbol rather than a line, with a lifecycle that runs across sessions.',
            ]}
          />
        </Card>
      </div>
    </Section>
  );
}
