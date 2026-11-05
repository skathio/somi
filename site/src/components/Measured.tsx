import { Bullets, Card, Rich, Section } from './ui';

export function Measured() {
  return (
    <Section
      id="measured"
      kicker="Measured, not claimed"
      title="5.0 has to earn the default"
      lede={<Rich text="Neither 5.0 candidate has passed its release rule. The second passes both quality checks but costs 2.35x bare in dollars per solved task against a limit of 1.5x. It costs 0.113x what 4.1 costs per draw, and 4.1 costs 16.69x bare. 5.0 stays a release candidate." />}
    >
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card title="The registered rule">
          <Bullets items={['**Primary:** dollars per solved task against bare, routed, on the same tasks and model.', '**Ships if:** that is at most 1.5x bare, the lower 95% bound is at or above -5 points on hidden tests passed and -20 points on tasks solved, and the A/A interval contains zero.']} />
        </Card>
        <Card title="Why it can be trusted">
          <Bullets items={['**A mixed task set:** some a bare agent sometimes solves, some it narrowly misses, and some it always solves, so a change shows either way.', '**Registered first:** the task set is committed before the first paid main draw.', '**Published as it fell:** on 16 tasks and 96 draws an arm, bare solved 73, the 5.0 candidate 70 and 4.1 63, at $0.118, $0.211 and $3.162 per solved task.']} />
        </Card>
      </div>
    </Section>
  );
}
