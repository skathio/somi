// setup.mjs: makes SoMi's agent the session's agent, on the model the user chose for its tier. The model sits on the agent the session runs as,
// so it holds for every follow-up and the conversation is not interrupted to change it. Model names differ per environment, so shared
// plugin files carry none: this writes a file in the user's own agent folder, from the user's own config, and changes nothing else.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TIERS, mainTier, resolveSpawn } from './tiers.mjs';
import { StateError, refuseLink } from './state.mjs';

const body = (pluginRoot) => fs.readFileSync(path.join(pluginRoot, 'agents', 'somi.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const DESCRIPTION = 'SoMi as the session agent, on the model set for its tier. It holds the conversation, routes work and keeps the cost down.';

export function setupAgent({ host, config = {}, pluginRoot, env = process.env, home = os.homedir() }) {
  const tier = mainTier(config);
  const { model } = resolveSpawn(config, host, tier);
  const example = { tiers: { main: 'low', [host]: { low: '<cheap model>', medium: '<everyday model>', high: '<strongest model>' } } };
  if (!model) return { written: false, reason: `no model is set for tier ${tier} on ${host}`, set_in_config: example };
  const dir = host === 'copilot' ? path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'agents') : path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'agents');
  const file = path.join(dir, host === 'copilot' ? 'somi-main.agent.md' : 'somi-main.md');
  fs.mkdirSync(dir, { recursive: true });
  if (refuseLink(file) && !fs.readFileSync(file, 'utf8').includes(DESCRIPTION)) throw new StateError(`${file} exists and is not SoMi's; move it first`);
  fs.writeFileSync(file, `---\nname: somi-main\ndescription: "${DESCRIPTION}"\nmodel: ${model}\n---\n\n${body(pluginRoot)}\n`);
  const missing = TIERS.filter((t) => !resolveSpawn(config, host, t).enforced);
  return {
    written: true,
    file,
    tier,
    model,
    start: host === 'copilot' ? 'copilot --agent somi-main' : 'claude --agent somi-main',
    ...(host === 'claude' ? { note: 'Passing --model as well overrides this. To make it the default in a project, set "agent": "somi-main" in .claude/settings.local.json.' } : {}),
    ...(missing.length > 0 ? { warning: `no model is set for tier ${missing.join(', ')} on ${host}, so work at those tiers runs on this session's model` } : {}),
  };
}
