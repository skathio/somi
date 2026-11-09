// SOMI-CANARY-N09-0d11aeb1872d1109
import { cases } from './cases.mjs';

const [, , name, nonce] = process.argv;
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
const load = (file) => import(process.env.TASK_WORKSPACE + '/' + file);
let out;
try { out = { value: await cases.find((c) => c.name === name).run(load) }; } catch (e) { out = { threw: String(e?.code ?? e?.name ?? 'Error') }; }
process.stdout.write('\n@@' + nonce + '@@' + JSON.stringify(out) + '\n');
process.exit(0);
