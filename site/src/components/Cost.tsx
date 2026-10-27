import { useState } from 'react';
import { FACTS } from '../lib/facts';
import { costLine, lowered, resolve, TIERS, type CostState, type Host, type Tier } from '../lib/resolver';
import { Bullets, Card, Rich, Section, TierBadge } from './ui';

const AGENTS = Object.keys(FACTS.agentDefaults);
const models = FACTS.claudeCodeModels;

export function Cost() {
  return (
    <Section
      id="cost"
      kicker="Cost system"
      title="Every agent runs at a tier you can see and control"
      lede="Tiers belong to agents, not commands. One resolver decides each agent's tier and model at dispatch, the same way on every host, and the agent's briefing says whether that model was actually applied."
    >
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card title="How a tier is resolved">
          <ol className="space-y-3">
            {[
              "**An agent's `cost.agents` entry wins**, even above the ceiling.",
              `**Otherwise the agent runs at the ceiling**, which is a hard cap and defaults to \`${FACTS.defaultCeiling}\`. Without an entry, an agent follows the ceiling up as well as down.`,
              `**The ceiling is read live on every dispatch**, in this order: flag, environment variable, \`.somi/config.json\`, a previously set ceiling, then \`${FACTS.defaultCeiling}\`.`,
              `**A tier maps to a model for each host.** Claude Code ships with \`${models.low}\` / \`${models.medium}\` / \`${models.high}\`. For other hosts you give an ordered preference list of up to ${FACTS.maxModelCandidates} ids.`,
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
                <span>
                  <Rich text={t} />
                </span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="What protects it">
          <Bullets
            items={[
              `**A default config is written at session start:** ceiling \`${FACTS.defaultCeiling}\`, and every agent pinned to the tier it was built for.`,
              "**Lowering needs you.** A PreToolUse hook holds any change that lowers an agent's effective tier, the ceiling, or the security reviewer below `high`. Remapping a tier to another model is held too.",
              '**No false claims.** A briefing says `dispatched at cost:` only when a model was enforced; otherwise it says `requested cost: … (not enforced)`.',
              '**Agents declare no `model:`**, so a launch that skips the resolver cannot run on the top tier unnoticed.',
            ]}
          />
        </Card>
      </div>
      <ResolverDemo />
    </Section>
  );
}

type ConfigMode = 'default' | 'none';

const HOSTS: { id: Host; label: string; note: string }[] = [
  { id: 'claude-code', label: 'Claude Code', note: 'Claude Code: the model is passed with each agent start.' },
  { id: 'copilot-cli', label: 'Copilot CLI', note: 'Copilot CLI ships no tier→model table, so the host default applies and the briefing says so.' },
  {
    id: 'copilot-cli-mapped',
    label: 'Copilot CLI + mapping',
    note: 'With cost.mapping.copilot-cli set, dispatch passes the first id the host offers. A live check on Copilot CLI is still pending.',
  },
];

function ResolverDemo() {
  const [config, setConfig] = useState<ConfigMode>('default');
  const [cost, setCost] = useState<CostState>({ ceiling: FACTS.defaultCeiling, pins: { ...FACTS.agentDefaults } });
  const [host, setHost] = useState<Host>('claude-code');
  const [selected, setSelected] = useState('somi-reviewer');
  const [held, setHeld] = useState<string | null>(null);

  const change = (next: CostState) => {
    setHeld(lowered(cost, next, AGENTS));
    setCost(next);
  };
  const pickConfig = (mode: ConfigMode) => {
    setConfig(mode);
    setHeld(null);
    setCost({ ceiling: cost.ceiling, pins: mode === 'default' ? { ...FACTS.agentDefaults } : {} });
  };
  const pin = (tier: Tier | 'none') => {
    const pins = { ...cost.pins };
    if (tier === 'none') delete pins[selected];
    else pins[selected] = tier;
    change({ ...cost, pins });
  };

  const result = resolve(cost, selected, FACTS.agentDefaults, host, models);

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface p-5 shadow-sm">
      <h3 className="text-lg font-semibold">Try the resolver</h3>
      <p className="text-muted">
        The same rules as <code>somi_resolve</code>, simplified. Pick an agent to see its dispatch.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <Segmented label=".somi/config.json" value={config} onChange={pickConfig} options={[{ v: 'default', label: 'default (pinned)' }, { v: 'none', label: 'no file' }]} />
        <Segmented label="cost.ceiling" value={cost.ceiling} onChange={(t) => change({ ...cost, ceiling: t })} options={TIERS.map((t) => ({ v: t, label: t }))} />
        <Segmented label="Host" value={host} onChange={setHost} options={HOSTS.map((h) => ({ v: h.id, label: h.label }))} />
      </div>

      <div role="group" aria-label="Agents" className="mt-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {AGENTS.map((a) => {
          const r = resolve(cost, a, FACTS.agentDefaults, host, models);
          return (
            <button
              key={a}
              type="button"
              aria-pressed={a === selected}
              onClick={() => setSelected(a)}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-left hover:border-accent aria-pressed:border-accent aria-pressed:ring-2 aria-pressed:ring-accent-soft"
            >
              <span className="truncate font-mono text-xs">{a.replace(/^somi-/, '')}</span>
              <span className="flex shrink-0 items-center gap-1">
                {r.degraded && (
                  <span title={`degraded: below ${r.declared}`} className="text-xs font-bold text-gate">
                    ▼
                  </span>
                )}
                <TierBadge tier={r.tier} />
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-muted">
        <span className="font-bold text-gate">▼</span> degraded: running below the tier the agent was built for.
      </p>

      {held && (
        <p role="status" className="mt-3 rounded-lg border border-gate bg-gate-soft px-3 py-2.5 text-sm">
          <b>Held for confirmation.</b> This lowers {held}. A PreToolUse hook asks you first; where no hook can ask, the{' '}
          <code>somi_config</code> tool refuses it.
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold">{selected}</span>
            <Segmented
              label="cost.agents entry"
              inline
              value={cost.pins[selected] ?? 'none'}
              onChange={pin}
              options={(['none', ...TIERS] as const).map((t) => ({ v: t, label: t }))}
            />
          </div>
          <p
            className={`rounded-r-lg border-l-4 bg-surface-2 px-3 py-2 font-mono text-sm ${result.enforced ? 'border-accent' : 'border-gate'}`}
          >
            {costLine(result)}
          </p>
          <p className="mt-2 text-sm text-muted">{HOSTS.find((h) => h.id === host)!.note}</p>
        </div>
        <pre aria-label="Resolver result" className="min-w-0 overflow-x-auto rounded-lg bg-code p-3 font-mono text-xs leading-relaxed sm:text-sm">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  inline?: boolean;
}

function Segmented<T extends string>({ label, value, options, onChange, inline }: SegmentedProps<T>) {
  return (
    <div className={inline ? 'flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2' : ''}>
      <span className={inline ? 'text-sm text-muted' : 'mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted'}>{label}</span>
      <div role="group" aria-label={label} className="inline-flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={o.v === value}
            onClick={() => onChange(o.v)}
            className="flex-1 whitespace-nowrap bg-surface px-3 py-1.5 text-sm text-muted hover:text-ink aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-canvas"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
