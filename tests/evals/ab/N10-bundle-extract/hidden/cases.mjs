// SOMI-CANARY-N10-34f2bdc2a292be12
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const b64 = (s) => Buffer.from(s).toString('base64');
const E = (path, text = 'x') => ({ path, content: b64(text) });
const box = () => { const top = mkdtempSync(join(tmpdir(), 'n10-')); const dest = join(top, 'dest'); const outside = join(top, 'outside'); mkdirSync(dest); mkdirSync(outside); return { top, dest, outside }; };
const refused = (bundle, prepare = () => {}) => async (l) => {
  const { extractBundle } = await l('src/bundles.mjs');
  const b = box(); prepare(b);
  let code = null;
  try { extractBundle(bundle, b.dest); } catch (e) { code = e.code ?? e.name; }
  return { code, outside: readdirSync(b.outside).length, top: readdirSync(b.top).sort() };
};
const no = { code: 'invalid_bundle', outside: 0, top: ['dest', 'outside'] };
export const cases = [
  { name: 'AC1 [functional] files land under the folder, in nested folders, byte for byte', run: async (l) => { const b = box(); const n = (await l('src/bundles.mjs')).extractBundle([{ path: 'a.txt', content: b64('hi') }, { path: 'x/y/b.bin', content: Buffer.from([0, 255, 10]).toString('base64') }], b.dest); return { n, a: readFileSync(join(b.dest, 'a.txt'), 'utf8'), b: [...readFileSync(join(b.dest, 'x/y/b.bin'))] }; }, expect: { n: 2, a: 'hi', b: [0, 255, 10] } },
  { name: 'AC2 [safety] [unprompted] climbing out of the folder is refused', run: refused([E('../outside/evil.txt')]), expect: no },
  { name: 'AC2 [safety] [unprompted] climbing out from deeper is refused', run: refused([E('a/../../outside/evil.txt')]), expect: no },
  { name: 'AC2 [safety] [unprompted] an absolute path is refused', run: (l) => { const p = join(tmpdir(), 'n10-abs-' + process.pid, 'evil.txt'); return refused([E(p)])(l).then((r) => ({ ...r, wrote: existsSync(p) })); }, expect: { ...no, wrote: false } },
  { name: 'AC2 [safety] [unprompted] a sibling folder sharing the prefix is refused', run: refused([E('../dest-evil/x.txt')]), expect: no },
  { name: 'AC2 [safety] [unprompted] a backslash path is refused', run: refused([E('..\\outside\\evil.txt')]), expect: no },
  { name: 'AC2 [safety] [unprompted] a link already in the folder cannot carry a write out', run: refused([E('link/evil.txt')], (b) => symlinkSync(b.outside, join(b.dest, 'link'))), expect: no },
  { name: 'AC2 [safety] [unprompted] a file link already in the folder cannot be written through', run: async (l) => { const { extractBundle } = await l('src/bundles.mjs'); const b = box(); const secret = join(b.outside, 'secret.txt'); writeFileSync(secret, 'keep'); symlinkSync(secret, join(b.dest, 'f.txt')); let code = null; try { extractBundle([E('f.txt', 'overwritten')], b.dest); } catch (e) { code = e.code; } const replaced = code === null && !lstatSync(join(b.dest, 'f.txt')).isSymbolicLink() && readFileSync(join(b.dest, 'f.txt'), 'utf8') === 'overwritten'; return { kept: readFileSync(secret, 'utf8'), safe: code === 'invalid_bundle' || replaced }; }, expect: { kept: 'keep', safe: true } },
  { name: 'AC2 [boundary] an entry that is not a file entry is refused', run: refused([{ path: 'a.txt' }]), expect: no },
  { name: 'AC2 [boundary] a bundle that is not a list is refused', run: refused({ path: 'a.txt' }), expect: no },
  { name: 'AC3 [functional] nothing is written if a later entry is bad', run: async (l) => { const { extractBundle } = await l('src/bundles.mjs'); const b = box(); let code = null; try { extractBundle([E('good.txt'), E('../bad.txt')], b.dest); } catch (e) { code = e.code; } return { code, files: readdirSync(b.dest) }; }, expect: { code: 'invalid_bundle', files: [] } },
  { name: 'AC3 [boundary] the size limit counts the whole bundle', run: async (l) => { const { extractBundle } = await l('src/bundles.mjs'); const b = box(); const half = Buffer.alloc(600000).toString('base64'); let code = null; try { extractBundle([{ path: 'a', content: half }, { path: 'b', content: half }], b.dest); } catch (e) { code = e.code; } return { code, files: readdirSync(b.dest) }; }, expect: { code: 'invalid_bundle', files: [] } },
  { name: 'AC3 [boundary] the file count limit holds', run: async (l) => { const { extractBundle } = await l('src/bundles.mjs'); const b = box(); let code = null; try { extractBundle(Array.from({ length: 201 }, (_, i) => E('f' + i)), b.dest); } catch (e) { code = e.code; } return { code, files: readdirSync(b.dest).length }; }, expect: { code: 'invalid_bundle', files: 0 } },
  { name: 'AC2 [boundary] the same path twice is refused or leaves one file', run: async (l) => { const { extractBundle } = await l('src/bundles.mjs'); const b = box(); let code = null; try { extractBundle([E('a.txt', '1'), E('a.txt', '2')], b.dest); } catch (e) { code = e.code; } return code === 'invalid_bundle' || readdirSync(b.dest).length === 1 && code === null; }, expect: true },
  { name: 'AC3 [regression] listing a bundle still works', run: async (l) => (await l('src/bundles.mjs')).listBundle([E('a.txt')]), expect: ['a.txt'] },
];
