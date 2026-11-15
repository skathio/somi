// chat-commands.mjs: SoMi's command line, reached from the chat. Users talk to the agent and rarely open a terminal, so `/somi doctor`
// or `/somi check --full` is answered with the exact command to run and how to treat it. Only text that is a verb and its own options
// counts: "check the login page" is a request and is routed as one. Every value must be a plain word, so nothing typed reaches the
// shell as anything but an argument, and a verb that changes the setup or SoMi's state is run only after the user says yes.

import { parseArgs } from 'node:util';

const HOSTS = ['claude', 'copilot'];
const SCOPES = ['commit', 'pr', 'repo'];
const flag = { type: 'boolean' };
const word = { type: 'string' };

// confirm: what the verb changes, said to the user before it runs. tool: a verb that has its own tool, which the agent calls instead.
// config: answered by the router itself, with the tiers and limits in force.
export const VERBS = {
  help: { what: 'Lists these commands.' },
  status: { what: 'Shows the open plan, decisions and findings.', run: true },
  doctor: { what: 'Checks SoMi\'s setup: the hooks, the sandbox, the tier models and the host.', options: { host: { ...word, one: HOSTS }, profile: flag }, run: true },
  check: { what: 'Runs the quality gate and the project\'s tests on this change.', options: { full: flag }, run: true },
  quality: { what: 'Scores code against the quality limits: the branch, one commit, or the whole codebase.', options: { scope: { ...word, one: SCOPES } }, tool: 'somi_quality' },
  review: { what: 'Reviews the current changes, whether or not the diff calls for it.', options: { security: flag }, tool: 'somi_review' },
  pr: { what: 'Writes the pull request text, refused while a needed review is missing.', tool: 'somi_pr' },
  config: { what: 'Shows and changes the models each tier uses and the quality limits.', config: true },
  slot: { what: 'Connects another plugin to a step, or lists what is connected.', options: { list: flag, remove: flag, confirm: flag, project: flag, mode: { ...word, one: ['read', 'write'] } }, positionals: 2, run: true, confirm: 'connects or removes a plugin at a step of SoMi\'s work' },
  setup: { what: 'Makes SoMi the session agent, on the model set for its tier.', options: { host: { ...word, one: HOSTS } }, run: true, confirm: 'writes SoMi\'s agent file into your own agent folder' },
  init: { what: 'Registers the staged workflow with Copilot CLI for every project.', options: { host: { ...word, one: ['copilot'] } }, run: true, confirm: 'adds SoMi\'s extension to your Copilot CLI home' },
  migrate: { what: 'Copies open findings and decisions from SoMi 4.x records, once.', run: true, confirm: 'copies the old records\' open findings and decisions into SoMi\'s current state' },
  launch: { what: 'Starts a new host session with SoMi\'s agent on its tier\'s model.', positionals: 1, oneOf: HOSTS, terminal: true },
};

const PLAIN = /^[\w.:/@-]{1,100}$/;

// The verb and its arguments when the text is one of SoMi's commands, or null when it is a request.
export function chatCommand(text) {
  const [verb, ...rest] = String(text ?? '').trim().replace(/^\/?(?:somi:)?somi\s+/i, '').split(/\s+/);
  const spec = VERBS[verb?.toLowerCase()];
  if (!spec || !rest.every((t) => PLAIN.test(t))) return null;
  const options = Object.fromEntries(Object.entries(spec.options ?? {}).map(([k, o]) => [k, { type: o.type }]));
  let parsed;
  try { parsed = parseArgs({ args: rest, options, allowPositionals: true, strict: true }); } catch { return null; }
  const { values, positionals } = parsed;
  if (positionals.length > (spec.positionals ?? 0) || (spec.oneOf && positionals.some((p) => !spec.oneOf.includes(p)))) return null;
  if (Object.entries(values).some(([k, v]) => spec.options[k].one && !spec.options[k].one.includes(v))) return null;
  return { verb: verb.toLowerCase(), values: { ...values }, positionals };
}

const argv = ({ verb, values, positionals }) => [verb, ...positionals, ...Object.entries(values).map(([k, v]) => (v === true ? `--${k}` : `--${k} ${v}`))].join(' ');
const HELP = Object.entries(VERBS).map(([verb, s]) => `/somi ${verb}: ${s.what}`).join('\n');

// What the agent does with a command. `cli` builds the shell form of SoMi's own command line.
export function commandAnswer(cmd, cli) {
  const spec = VERBS[cmd.verb];
  if (cmd.verb === 'help') return { route: 'command', verb: 'help', commands: HELP, advice: 'Show the user these commands as a short list, and say that anything else after /somi is routed as a request.' };
  if (spec.tool) return { route: 'command', verb: cmd.verb, tool: spec.tool, options: cmd.values, advice: toolAdvice(cmd) };
  const run = cli(argv(cmd));
  if (spec.terminal) return { route: 'command', verb: cmd.verb, run, advice: `This starts a new session, so it does not run inside this one. Give the user the command to run in a terminal of their own, or to put in an alias: \`${run}\`.` };
  const asks = spec.confirm && !(cmd.verb === 'slot' && cmd.values.list);
  return { route: 'command', verb: cmd.verb, run, ...(asks ? { confirm: spec.confirm } : {}), advice: `${asks ? `This ${spec.confirm}. Tell the user so in one line, and run it only after they say yes. ` : ''}Run \`${run}\` in the shell and relay what it says in a few lines, failures first.` };
}

function toolAdvice({ verb, values }) {
  if (verb === 'quality') return `Call somi_quality${values.scope ? ` with scope ${values.scope}` : ''}, and relay what it finds, worst first.`;
  if (verb === 'review') return `Call somi_review with always true${values.security ? ' and security true' : ''}, and follow what it says. Tell the user what was found, and change nothing unless they ask.`;
  return 'Call somi_pr. If it refuses, it says why: relay that, and do what it names.';
}
