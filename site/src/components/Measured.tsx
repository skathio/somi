import { Bullets, Card, Rich, Section } from './ui';

export function Measured() {
  return (
    <Section
      id="measured"
      kicker="Measured, not claimed"
      title="5.0 has to earn the default"
      lede={<Rich text="On Sonnet, over 16 tasks and 96 draws an arm, 5.0 solved 90 against a bare agent's 72, passed the quality gate on all 96 against 84, and had 62 strict successes against 46. It cost 1.28x bare per solved task, under the registered limit of 1.5x." />}
    >
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card title="The registered rule">
          <Bullets items={['**Primary:** dollars per solved task against bare, routed, on the same tasks and model.', '**Ships if:** that is at most 1.5x bare, the lower 95% bound is at or above -5 points on hidden tests passed and -20 points on tasks solved, and the A/A interval contains zero.']} />
        </Card>
        <Card title="Why it can be trusted">
          <Bullets items={['**A mixed task set:** some a bare agent sometimes solves, some it narrowly misses, and some it always solves, so a change shows either way.', '**Registered first:** the task set is committed before the first paid main draw.', '**Published as it fell:** the two 5.0 candidates before this one solved more than bare but failed on cost, at 1.68x and 1.74x, and their records stay in the repository.', '**What it does not show:** on these tasks the agent rarely routes, so the gain comes from the rules, the quality gate and the review. Routing has not yet been measured on work large enough to need it.']} />
        </Card>
      </div>
    </Section>
  );
}
