#!/usr/bin/env node
// Prints the L0 footprint (bytes of instruction and context text reaching a model) per scenario.
//   node tests/scripts/manual/usage-l0.mjs [--repo DIR] [--scenarios FILE] [--frontmatter include|strip] [--json]
// Hook scripts of the repo are run with synthetic input in a temp project directory (no shell, a timeout, an
// allowlisted environment); the real .somi/audit.log is never written. Tool definitions are read from the repo's
// own MCP server over stdio and passed to the lib as data. The server's install path is replaced by a fixed
// placeholder so the byte count does not depend on where the repo is checked out.
// Exit 0 printed, 64 usage error, 65 a measurement was refused.
import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureL0, l0Section, formatTable, FRONTMATTER_MODES } from '../../evals/lib/bench-l0.mjs';
import { McpClient } from '../lib/somi-mcp-client.mjs';

const usage = 'usage: usage-l0.mjs [--repo DIR] [--scenarios FILE] [--frontmatter include|strip] [--json]';
const PLACEHOLDER = '<install>';
const MCP_TIMEOUT_MS = 10000;

function parse(argv) {
  const a = { repo: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), json: false, frontmatter: 'include' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') a.json = true;
    else if (argv[i] === '--repo' && argv[i + 1]) a.repo = resolve(argv[++i]);
    else if (argv[i] === '--scenarios' && argv[i + 1]) a.scenarios = resolve(argv[++i]);
    else if (argv[i] === '--frontmatter' && FRONTMATTER_MODES.includes(argv[i + 1])) a.frontmatter = argv[++i];
    else return null;
  }
  a.scenarios ??= join(a.repo, 'benchmarks', 'usage-speed', 'l0-scenarios.json');
  return a;
}

async function toolTexts(repo, names) {
  if (names.size === 0) return {};
  const client = new McpClient(join(repo, 'scripts', 'somi-mcp.mjs'));
  let timer;
  try {
    const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('the MCP server did not answer in time')), MCP_TIMEOUT_MS); });
    const list = await Promise.race([(async () => { await client.initialize(); return client.request('tools/list', {}); })(), limit]);
    const out = {};
    for (const t of list.tools ?? []) if (names.has(t.name)) out[t.name] = JSON.stringify(t).split(repo).join(PLACEHOLDER);
    return out;
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

async function main(argv) {
  const a = parse(argv);
  if (!a) { console.error(usage); return 64; }
  try {
    const file = JSON.parse(readFileSync(a.scenarios, 'utf8'));
    const scenarios = file.scenarios;
    const names = new Set((scenarios ?? []).flatMap((s) => (s.components ?? []).filter((c) => c.kind === 'tool').map((c) => c.name)));
    const tools = await toolTexts(a.repo, names);
    const result = await measureL0({ repo: a.repo, scenarios, tools, frontmatter: a.frontmatter });
    if (a.json) console.log(JSON.stringify({ schema: 1, frontmatter: a.frontmatter, scenarios: result, L0: l0Section(result) }, null, 2));
    else console.log(`${formatTable(result)}\n\nfrontmatter: ${a.frontmatter}`);
    return 0;
  } catch (e) {
    console.error(`refused: ${e.message}`);
    return 65;
  }
}

process.exitCode = await main(process.argv.slice(2));
