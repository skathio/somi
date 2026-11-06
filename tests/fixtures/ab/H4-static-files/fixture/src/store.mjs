// The shared folder (shared/ next to src/) as the service sees it.
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SHARED_DIR = fileURLToPath(new URL('../shared/', import.meta.url));

// Folders first, then files; each group by lower-case name.
export function compareEntries(a, b) {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

// The entries directly inside the shared folder: { name, type: 'file' | 'dir', size } (size is null for a folder).
export function listShared() {
  return readdirSync(SHARED_DIR, { withFileTypes: true })
    .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', size: e.isDirectory() ? null : statSync(SHARED_DIR + e.name).size }))
    .sort(compareEntries);
}
