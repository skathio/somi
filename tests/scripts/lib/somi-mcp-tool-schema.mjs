#!/usr/bin/env node
// Drives scripts/somi-mcp.mjs's REAL `tools/list` (over real stdio JSON-RPC, via the same
// McpClient tests/scripts/lib/somi-mcp-tests.mjs uses) and prints each tool's name -> {required,
// properties} as one JSON object on stdout.
//
// tests/scripts/somi-agent-dispatch-contract.sh reads this to check agents/somi.md's Step 4/5
// against the server's actual advertised schema, instead of a hand-typed copy of the tool/argument
// names that could quietly drift from what the server really exposes.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from './somi-mcp-client.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER = path.join(ROOT, 'scripts', 'somi-mcp.mjs');

async function main() {
  const client = new McpClient(SERVER, {});
  try {
    await client.initialize();
    const { tools } = await client.request('tools/list', {});
    const shape = {};
    for (const t of tools || []) {
      shape[t.name] = {
        required: [...(t.inputSchema?.required || [])].sort(),
        properties: Object.keys(t.inputSchema?.properties || {}).sort(),
      };
    }
    process.stdout.write(JSON.stringify(shape));
  } finally {
    client.close();
  }
}

main().catch((e) => {
  console.error(`somi-mcp-tool-schema: ${e.stack || e}`);
  process.exit(1);
});
