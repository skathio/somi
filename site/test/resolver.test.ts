import { describe, expect, it } from 'vitest';
import { costLine, effectiveTier, lowered, resolve, type CostState, type Tier } from '../src/lib/resolver';

const defaults: Record<string, Tier> = { 'somi-coder': 'medium', 'somi-reviewer': 'high', 'somi-security-reviewer': 'high' };
const agents = Object.keys(defaults);
const models: Record<Tier, string> = { low: 'm-low', medium: 'm-medium', high: 'm-high' };

describe('effectiveTier', () => {
  it('uses the cost.agents entry, even above the ceiling', () => {
    expect(effectiveTier({ ceiling: 'low', pins: { 'somi-reviewer': 'high' } }, 'somi-reviewer')).toBe('high');
  });
  it('follows the ceiling without an entry, up as well as down', () => {
    expect(effectiveTier({ ceiling: 'low', pins: {} }, 'somi-reviewer')).toBe('low');
    expect(effectiveTier({ ceiling: 'high', pins: {} }, 'somi-coder')).toBe('high');
  });
});

describe('resolve', () => {
  it('reports the source and degradation', () => {
    const r = resolve({ ceiling: 'medium', pins: {} }, 'somi-reviewer', defaults, 'claude-code', models);
    expect(r).toMatchObject({ agent_type: 'somi:somi-reviewer', declared: 'high', tier: 'medium', tier_source: 'ceiling', degraded: true });
    const pinned = resolve({ ceiling: 'medium', pins: { 'somi-reviewer': 'high' } }, 'somi-reviewer', defaults, 'claude-code', models);
    expect(pinned).toMatchObject({ tier: 'high', tier_source: 'override', degraded: false, model: 'm-high', enforced: true });
  });
  it('enforces a model only where one is mapped', () => {
    const state: CostState = { ceiling: 'high', pins: {} };
    expect(resolve(state, 'somi-coder', defaults, 'copilot-cli', models)).toMatchObject({ model: null, enforced: false });
    expect(resolve(state, 'somi-coder', defaults, 'copilot-cli-mapped', models)).toMatchObject({ enforced: true });
    expect(resolve(state, 'somi-coder', defaults, 'copilot-cli-mapped', models).model_candidates).toHaveLength(1);
  });
  it('refuses an agent the table does not know', () => {
    expect(() => resolve({ ceiling: 'low', pins: {} }, 'coder', defaults, 'claude-code', models)).toThrow(/unknown agent/);
  });
});

describe('costLine', () => {
  it('claims an applied tier only when enforced', () => {
    const state: CostState = { ceiling: 'medium', pins: {} };
    expect(costLine(resolve(state, 'somi-coder', defaults, 'claude-code', models))).toBe('dispatched at cost: medium');
    expect(costLine(resolve(state, 'somi-coder', defaults, 'copilot-cli', models))).toBe('requested cost: medium (not enforced: no mapped model)');
  });
});

describe('lowered', () => {
  const pinned: CostState = { ceiling: 'medium', pins: { ...defaults } };
  it('flags a lower ceiling even when every agent is pinned', () => {
    expect(lowered(pinned, { ...pinned, ceiling: 'low' }, agents)).toBe('the ceiling');
  });
  it('names the one agent whose tier drops, or counts several', () => {
    expect(lowered(pinned, { ...pinned, pins: { ...defaults, 'somi-security-reviewer': 'medium' } }, agents)).toBe('somi-security-reviewer');
    expect(lowered(pinned, { ceiling: 'medium', pins: {} }, agents)).toBe('2 agents');
  });
  it('lets a raise through', () => {
    expect(lowered(pinned, { ...pinned, ceiling: 'high' }, agents)).toBeNull();
    expect(lowered(pinned, { ...pinned, pins: { ...defaults, 'somi-coder': 'high' } }, agents)).toBeNull();
  });
});
