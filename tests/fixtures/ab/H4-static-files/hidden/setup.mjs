// SOMI-CANARY-H4-9b3f2a61d07e4c58
// Workspace setup, run as `node setup.mjs <workspace>` after the fixture is copied and before anything else touches the workspace.
// These shared files have names that Windows cannot hold (< > " ?), so git does not carry them: they are made here from this table.
// A candidate workspace therefore contains them at run time, and the driver must run this setup BEFORE it takes the 'before' manifest
// snapshot, so they never count as candidate changes. POSIX hosts only.
import fs from 'node:fs';
import path from 'node:path';

const NAMES = [
  'what?.txt',
  'say "hi".txt',
  '<b>bold.txt',
  '<img src=x onerror=alert(1)>.txt',
  'x" onmouseover="alert(1).txt',
  'reports/<i>q2.txt',
  'Q&A <drafts>/x.txt',
];
const [, , workspace] = process.argv;
if (!workspace) process.exit(2);
for (const rel of NAMES) {
  const to = path.join(workspace, 'shared', rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, `${rel}\nshared file\n`);
}
