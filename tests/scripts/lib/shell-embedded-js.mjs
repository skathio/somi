#!/usr/bin/env node
// Guards the `node -e "..."` blocks in the shell test scripts against their own quoting hazards.
//
// Inside a double-quoted shell string a BACKTICK is command substitution and a DOUBLE QUOTE ends
// the program. Both have bitten: a comment reading `-- the same "measured the wrong thing" shape`
// terminated the string, node received mangled source and exited with no output on either stream,
// and the assertion reported `got ''`. A backticked code span in the file's own comment idiom --
// which is how every other comment here is written -- executes the span as a command; one such
// span in this repo is `bash tests/scripts/evals-fixtures.sh --update-manifest`, which would
// recursively invoke the guard's own manifest path.
//
// The durable fix is to keep programs OUT of shell strings (see lib/adr-shape.mjs and
// lib/reference-pair.mjs). This catches the ones still inline, so the class cannot reopen quietly.
//
// SCOPE, deliberately narrow. Inside a block, the first unescaped `"` IS the terminator -- that is
// what the shell does, and a syntactic scan cannot tell an intended terminator from an accidental
// one. What it CAN tell:
//   - a backtick anywhere inside a block: always command substitution, never intended
//   - a `"` inside a JS COMMENT line: always accidental, since a comment cannot be the terminator
// Both are real instances that shipped. A broader rule flagged 50 lines of correct code, and a
// guard that reports 50 findings reports none.

import { readFileSync } from 'node:fs';

const problems = [];
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inBlock = false;
  lines.forEach((line, n) => {
    if (!inBlock) {
      const at = line.search(/node (--input-type=module )?-e "/);
      if (at === -1) return;
      const after = line.slice(line.indexOf('-e "', at) + 4);
      if (!/(^|[^\\])"/.test(after)) inBlock = true;   // opened and left open
      return;
    }
    const trimmed = line.trim();
    if (line.includes('`')) {
      problems.push(`${file}:${n + 1}: backtick inside a node -e block -- the shell executes it: ${trimmed.slice(0, 64)}`);
    }
    if (trimmed.startsWith('//') && /"/.test(line)) {
      problems.push(`${file}:${n + 1}: double quote in a comment inside a node -e block -- it ends the program: ${trimmed.slice(0, 64)}`);
    }
    if (/(^|[^\\])"/.test(line)) inBlock = false;      // the terminator, wherever it falls
  });
}
process.stdout.write(problems.length ? problems.join('\n') : 'ok');
