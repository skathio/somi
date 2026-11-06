// SOMI-CANARY-H4-9b3f2a61d07e4c58
// The shared folder (shared/ next to src/) as the service sees it.
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARED_DIR = fileURLToPath(new URL('../shared/', import.meta.url));

// Folders first, then files; each group by lower-case name.
export function compareEntries(a, b) {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

// The entries directly inside a folder: { name, type: 'file' | 'dir', size } (size is null for a folder).
// Anything that is neither a regular file nor a folder (a link, a socket) is not shared.
export function listFolder(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const st = lstatSync(join(dir, name));
    if (st.isDirectory()) entries.push({ name, type: 'dir', size: null });
    else if (st.isFile()) entries.push({ name, type: 'file', size: st.size });
  }
  return entries.sort(compareEntries);
}

export const listShared = () => listFolder(SHARED_DIR);
