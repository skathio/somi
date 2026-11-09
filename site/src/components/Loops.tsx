import { Bullets, Card, Rich, Section } from './ui';

export function Loops() {
  return (
    <Section
      id="loops"
      kicker="Review policy"
      title="The review loop cannot generate its own work"
      lede={<Rich text="The rules are constants in code, not the model's memory, and a project's config cannot lower them. Tools record every review, so a new or compacted session knows what is still open." />}
    >
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card title="What re-loops">
          <Bullets items={['**A Blocker.**', '**A Major confirmed on a real boundary:** file, line and an exploit or failing input.', '**At most two passes.** A third needs you.']} />
        </Card>
        <Card title="What never re-loops">
          <Bullets items={['**Minor and Nit findings:** logged and shown in `/somi-status`.', '**Approve-with-comments:** done.', '**The same finding twice in a row:** stops and asks you.']} />
        </Card>
      </div>
    </Section>
  );
}
