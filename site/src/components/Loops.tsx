import { Bullets, Card, Rich, Section } from './ui';

export function Loops() {
  return (
    <Section
      id="loops"
      kicker="Review policy"
      title="The review loop cannot generate its own work"
      lede={<Rich text="The state machine holds the rules, not the model's memory. Tools write one journal, so a run can stop and resume without a state file to edit by hand." />}
    >
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card title="What re-loops">
          <Bullets items={['**A Blocker.**', '**A Major confirmed on a real boundary:** file, line and an exploit or failing input.', '**At most two passes.** The second reads only the fix diff. A third needs you.']} />
        </Card>
        <Card title="What never re-loops">
          <Bullets items={['**Minor and Nit findings:** logged and shown in `/status`.', '**Approve-with-comments:** done.', '**The same finding twice in a row:** stops and asks you.']} />
        </Card>
      </div>
    </Section>
  );
}
