#!/usr/bin/env node
// Fails when an agent, command or skill file has no frontmatter, or a frontmatter line that a
// YAML parser rejects. Claude Code tolerates `description: ... divergence: did ...`; the GitHub
// Copilot host does not, and skips the whole agent with "mapping values are not allowed".
//
// This is not a YAML parser. SoMi's frontmatter is flat `key: value` lines, so the check enforces
// that shape and rejects the plain-scalar forms YAML forbids. Anything else must be quoted, and a
// double-quoted value must also be a valid JSON string. Zero-dependency on purpose.
//
// Usage: node scripts/check-frontmatter.mjs [root]   (exit 0 clean, 1 on any violation)
import fs from 'node:fs';
import path from 'node:path';

const KEY_LINE = /^([A-Za-z][\w-]*):(?: (.*))?$/;
// A plain scalar may not start with a YAML indicator character.
const INDICATOR_START = /^(?:[[\]{},#&*!|>'"%@`]|[-?:](?:\s|$))/;

export function frontmatterErrors(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return ['no frontmatter: the first line is not ---'];
  const end = lines.indexOf('---', 1);
  if (end === -1) return ['frontmatter is never closed with ---'];
  const errors = [];
  for (let i = 1; i < end; i++) {
    const problem = lineProblem(lines[i]);
    if (problem) errors.push(`line ${i + 1}: ${problem}`);
  }
  return errors;
}

function lineProblem(line) {
  if (line.trim() === '' || line.startsWith('#')) return null;
  const m = KEY_LINE.exec(line);
  if (!m) return 'not a flat `key: value` line';
  const value = (m[2] ?? '').trim();
  if (value === '') return null;
  if (value.startsWith('"')) return doubleQuotedProblem(value);
  if (value.startsWith("'")) {
    return /^'(?:[^']|'')*'$/.test(value) ? null : 'unterminated or malformed single-quoted value';
  }
  if (INDICATOR_START.test(value)) return `\`${m[1]}\` starts with a YAML indicator; quote the value`;
  if (/:\s/.test(value) || value.endsWith(':')) return `\`${m[1]}\` contains ": "; quote the value`;
  if (/\s#/.test(value)) return `\`${m[1]}\` contains " #", which YAML reads as a comment; quote the value`;
  return null;
}

function doubleQuotedProblem(value) {
  try {
    return typeof JSON.parse(value) === 'string' ? null : 'malformed double-quoted value';
  } catch {
    return 'malformed double-quoted value (must also be a valid JSON string)';
  }
}

function promptFiles(root) {
  const files = [];
  for (const dir of ['agents', 'commands']) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (name.endsWith('.md')) files.push(path.join(dir, name));
    }
  }
  for (const name of fs.readdirSync(path.join(root, 'skills'))) {
    const skill = path.join('skills', name, 'SKILL.md');
    if (fs.existsSync(path.join(root, skill))) files.push(skill);
  }
  return files.sort();
}

function main() {
  const root = path.resolve(process.argv[2] ?? '.');
  let failed = 0;
  for (const rel of promptFiles(root)) {
    for (const e of frontmatterErrors(fs.readFileSync(path.join(root, rel), 'utf8'))) {
      console.error(`FRONTMATTER: ${rel}: ${e}`);
      failed++;
    }
  }
  if (failed) process.exit(1);
  console.log('  ok: every agent, command and skill has well-formed frontmatter');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
