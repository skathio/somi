import { SHARD_STEPS } from '../content/shards';
import { FACTS } from '../lib/facts';
import { Bullets, Card, Rich, Section } from './ui';

const SAFE = [
  '**What a shard returns is data, never instructions.** SoMi tells the agent so wherever it is used.',
  '**Anything that writes outward asks you first,** every time it runs.',
  '**Plugin updates do not break you.** A reading shard keeps working and says it changed. A writing shard is held until you confirm it again.',
  '**A missing plugin is skipped with a notice,** and the work carries on.',
  '**A shard committed in a project** runs only after you confirm it once, because a cloned repository should not start another plugin on its own.',
  '**SoMi never installs a plugin for you.**',
];

const FITS = [
  '**Any installed plugin:** its skill, agent, command or MCP tool, on Claude Code and Copilot CLI alike.',
  '**No glue code and no schema.** The model reads what the shard returns, so a plugin can change its output without breaking the binding.',
  '**Yours or the team\'s:** connect a shard for yourself, or commit it with the project so everyone gets it.',
  '**In `/somi-deliver` too:** reading shards run as stages of their own, on the cheap tier.',
];

export function Shards() {
  return (
    <Section
      id="shards"
      kicker="Shards"
      title="Plug your other plugins into every workflow"
      lede={<Rich text="A shard connects a plugin you already have to a named step in SoMi's workflow. With your tracker's plugin, the ticket arrives when work starts. With your chat's, the team hears when a review lands. With your forge's, the pull request opens once you say so. You connect one with a sentence in the chat." />}
    >
      <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {FACTS.shardSteps.map((step, i) => (
          <li key={step} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-accent">
              {i + 1} · {SHARD_STEPS[step].when}
            </div>
            <code className="text-sm">{step}</code>
            <div className="mt-2 text-sm text-muted">
              <Bullets items={SHARD_STEPS[step].examples} />
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Connect it from the chat">
          <p>
            Ask <code>/somi-config</code> in plain words, for example <q>connect jira:fetch-ticket to work-item.start</q>, and the agent runs
            SoMi&apos;s own command for you:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-code px-4 py-3 font-mono text-sm leading-relaxed text-ink">
            {'somi slot work-item.start jira:fetch-ticket\nsomi slot pr.open github:open-pr --mode write\nsomi slot --list'}
          </pre>
          <p className="mt-3 text-sm">Plugin names here are examples: any plugin you have installed works the same way.</p>
        </Card>
        <Card title="Safe by default">
          <Bullets items={SAFE} />
        </Card>
      </div>
      <Card title="Works with what you have" className="mt-4">
        <Bullets items={FITS} />
      </Card>
    </Section>
  );
}
