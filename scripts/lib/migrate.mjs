// migrate.mjs: imports what is still open from a 4.x `.somi/` tree into the journal: open findings and recorded decisions. Old files
// are only read, never changed, and 5.0 does not read them again afterwards. Those files may come from a cloned repository, so links,
// odd slugs and oversized files are skipped rather than followed.

import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION, appendEvent, deriveCursor, readEvents, writeCursor } from './journal.mjs';
import { SEVERITIES } from './policy.mjs';

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 50;
const MAX_TEXT = 400;

function readPlainFile(file) {
  let st;
  try { st = fs.lstatSync(file); } catch { return null; }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
  return fs.readFileSync(file, 'utf8');
}

function listSlugs(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && SLUG.test(e.name)).map((e) => e.name);
}

function openFindings(root, slug) {
  const text = readPlainFile(path.join(root, '.somi', 'reviews', slug, 'findings.json'));
  if (text === null) return [];
  let parsed;
  try { parsed = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(parsed?.findings) ? parsed.findings : [];
  return list.filter((f) => f?.status === 'open' && typeof f.title === 'string').slice(0, MAX_ITEMS).map((f) => ({
    id: String(f.id ?? '').slice(0, 32),
    severity: SEVERITIES.includes(f.severity) ? f.severity : 'Minor',
    file: typeof f.locus?.file === 'string' ? f.locus.file.slice(0, 240) : slug,
    line: null,
    claim: f.title.slice(0, MAX_TEXT),
  }));
}

function recordedDecisions(root, slug) {
  const text = readPlainFile(path.join(root, '.somi', 'plans', slug, 'decisions.md'));
  if (text === null) return [];
  return [...text.matchAll(/^## (D\d+[a-z]?)\s*[—-]\s*(.+)$/gm)].slice(0, MAX_ITEMS).map((m) => `${slug}: ${m[2].slice(0, MAX_TEXT)}`);
}

export function migrate({ root, env = process.env, now }) {
  const somi = path.join(root, '.somi');
  try { if (fs.lstatSync(somi).isSymbolicLink()) return { imported: [], skipped: ['.somi is a link'] }; } catch { return { imported: [], skipped: [] }; }
  const slugs = [...new Set([...listSlugs(path.join(somi, 'plans')), ...listSlugs(path.join(somi, 'reviews'))])].sort();
  const imported = [];
  let events = readEvents(root, env);
  for (const slug of slugs) {
    const key = `migrate:${slug}`;
    if (events.some((e) => e.key === key)) continue;
    const findings = openFindings(root, slug);
    const decisions = recordedDecisions(root, slug);
    if (findings.length + decisions.length === 0) continue;
    const event = { v: SCHEMA_VERSION, seq: events.length + 1, ts: now(), key, type: 'migrate', slug, findings, decisions };
    appendEvent(root, event, env);
    events = [...events, event];
    imported.push({ slug, findings: findings.length, decisions: decisions.length });
  }
  if (imported.length > 0) writeCursor(root, deriveCursor(events), env);
  return { imported, skipped: [] };
}
