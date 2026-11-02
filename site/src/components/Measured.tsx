import { Bullets, Card, Rich, Section } from './ui';

export function Measured() {
  return (
    <Section
      id="measured"
      kicker="Measured, not claimed"
      title="5.0 has to earn the default"
      lede={<Rich text="SoMi 4.1 measured 3x to 7x the cost and 2x to 6x the time of a bare agent on tasks both solved. The 5.0 recording has not run, so this page claims no result for it." />}
    >
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card title="The registered rule">
          <Bullets items={['**Primary:** the paired per-task success difference against bare, clustered by task.', '**Ships if:** the lower 95% bound is at or above -5 points, tokens per solved task are at most 1.5x bare, and the A/A interval contains zero.']} />
        </Card>
        <Card title="Why it can be trusted">
          <Bullets items={['**Off-ceiling tasks:** bare solves 1 or 2 of 3, so an arm has room to move.', '**Registered first:** the task set is committed before the first paid main draw.']} />
        </Card>
      </div>
    </Section>
  );
}
