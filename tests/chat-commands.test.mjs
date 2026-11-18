// SoMi's command line from the chat: `/somi doctor` is answered with the command to run, and anything that is not a verb and its own
// options is a request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers.mjs';
import { advise } from '../scripts/lib/advisor.mjs';
import { VERBS, chatCommand, commandAnswer } from '../scripts/lib/chat-commands.mjs';

const cli = (args) => `somi ${args}`;
const env = { ...process.env, SOMI_GLOBAL_CONFIG: '' };
const makeCtx = (dir) => ({ root: dir, env, config: {}, configLayers: [{}], host: 'claude', now: () => '2026-01-02T00:00:00Z' });

test('a verb with its own options is a command, typed with or without /somi in front, and anything else is a request', () => {
  assert.deepEqual(chatCommand('check --full'), { verb: 'check', values: { full: true }, positionals: [] });
  assert.equal(chatCommand('/somi doctor')?.verb, 'doctor');
  assert.equal(chatCommand('Doctor --profile')?.verb, 'doctor');
  for (const request of ['check the login page', 'review the auth module for leaks', 'status of the export job', 'somify the names', '']) assert.equal(chatCommand(request), null, request);
});

test('nothing typed reaches the shell but a plain word: an unknown option, a wrong value or shell syntax makes it a request', () => {
  for (const text of ['launch claude; rm -rf /', 'check --full $(id)', 'doctor --host windows', 'quality --scope nope', 'check --verbose', 'slot a b c', 'launch emacs', 'check `id`', 'pr --base "x y"']) assert.equal(chatCommand(text), null, text);
});

test('a verb that only reads runs at once, and one that changes the setup or SoMi\'s state runs only after the user says yes', () => {
  const doctor = commandAnswer(chatCommand('doctor --host copilot'), cli);
  assert.equal(doctor.run, 'somi doctor --host copilot');
  assert.equal(doctor.confirm, undefined);
  assert.match(doctor.advice, /^Run `somi doctor --host copilot` in the shell/);
  for (const text of ['setup', 'init', 'migrate', 'slot build other:checker']) {
    const a = commandAnswer(chatCommand(text), cli);
    assert.ok(a.confirm, text);
    assert.match(a.advice, /run it only after they say yes/, text);
  }
  assert.equal(commandAnswer(chatCommand('slot --list'), cli).confirm, undefined, 'listing what is connected changes nothing');
});

test('a verb with its own tool goes to the tool, and launch is given to the user for a terminal of their own', () => {
  assert.match(commandAnswer(chatCommand('quality --scope repo'), cli).advice, /^Call somi_quality with scope repo/);
  assert.match(commandAnswer(chatCommand('review --security'), cli).advice, /^Call somi_review with always true and security true/);
  assert.match(commandAnswer(chatCommand('pr'), cli).advice, /^Call somi_pr\./);
  const launch = commandAnswer(chatCommand('launch copilot'), cli);
  assert.equal(launch.run, 'somi launch copilot');
  assert.match(launch.advice, /does not run inside this one/);
  const help = commandAnswer(chatCommand('help'), cli);
  for (const verb of Object.keys(VERBS)) assert.match(help.commands, new RegExp(`^/somi ${verb}: `, 'm'));
});

test('the router answers a command before routing, and config with the tiers and limits in force', (t) => {
  const dir = makeRepo(t);
  const doctor = advise(makeCtx(dir), { request: 'doctor' });
  assert.equal(doctor.route, 'command');
  assert.match(doctor.run, /somi\.mjs" doctor$/);
  assert.equal(advise(makeCtx(dir), { request: 'config' }).route, 'config');
  assert.equal(advise(makeCtx(dir), { request: 'check the login page for broken links' }).route === 'command', false);
});
