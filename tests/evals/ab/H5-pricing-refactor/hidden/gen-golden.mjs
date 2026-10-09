// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Regenerates golden.json from the fixture's original src/pricing.mjs:
//   node gen-golden.mjs <path to the fixture's src/pricing.mjs> > golden.json
// It must print the committed golden.json byte for byte. Only the original implementation may be used to produce it.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildExtra, buildGroups, record } from './carts.mjs';

const mod = await import(pathToFileURL(resolve(process.argv[2])).href);
const lines = [];
for (const g of [...buildGroups(), ...buildExtra()]) for (const { id, cart } of g.carts) lines.push('  ' + JSON.stringify(id) + ': ' + JSON.stringify(record(mod, structuredClone(cart))));
process.stdout.write('{\n  "_canary": "SOMI-CANARY-H5-6c2e9a41d7b3f085",\n' + lines.join(',\n') + '\n}\n');
