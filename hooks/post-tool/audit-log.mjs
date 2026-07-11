#!/usr/bin/env node
// hooks/post-tool/audit-log.mjs — PostToolUse hook (matcher: *) — record every tool call to
// the SOMI audit log.
//
// Node port of hooks/post-tool/audit-log.sh (node-runtime-port, phase 2, iteration 2.6).
// The simplest hook in the corpus: append-only, no decision logic beyond field extraction
// already ported in 2.1 (../lib/common.mjs). Pairs with the BLOCK entries written from
// pre-tool hooks: gives you a single log to grep for "what did the agent actually do during
// this session?" Sensitive arguments are trimmed; we record tool name, status, and a short
// summary.
//
// Line format is the frozen contract (spec.md §9): "timestamp\tkind\ttool\tdetail\n",
// byte-exact — common.mjs's audit() owns that shape; this file only builds `detail`.
//
// TRUNCATION-BOUNDARY NOTE (F-14, phase-2-hooks-port.md, iteration 2.6): bash's
// `head -c 240` truncates at exactly 240 BYTES, not characters — verified directly against
// the unmodified bash original before this port existed (see progress.md/diary.md, 2.6):
// a 271-byte compact tool_input truncates to exactly 240 bytes, dropping the tail including
// the closing `"}`. truncateBytes() below reproduces that byte-exact cut via a UTF-8 Buffer
// slice (Buffer.from(str, 'utf8').subarray(0, 240)), NOT a UTF-16-code-unit `.slice(0, 240)`
// — the latter would cut at the wrong BYTE position for any non-ASCII content before the
// boundary, not just diverge at the tail. One residual, DOCUMENTED divergence: bash's
// `head -c` writes raw, possibly-invalid-UTF-8 bytes straight to the file if the cut lands
// mid multi-byte character (confirmed directly: a command containing "€" split at its byte
// 240 boundary leaves bash's audit log with a lone, invalid lead byte). common.mjs's audit()
// takes a JS string, not a raw byte buffer, so this port must decode the truncated bytes back
// to a string before handing it to audit() — `.toString('utf8')` replaces an incomplete
// trailing sequence with U+FFFD instead of preserving bash's raw invalid bytes. This is a
// safe-direction divergence (well-formed UTF-8 emitted vs. bash's malformed tail), inert for
// every case in the fixture corpus (ASCII-only), and only reachable via genuinely pathological
// input (a command/tool_input whose UTF-8 encoding is >240 bytes with a multi-byte character
// straddling the cut) — named here rather than silently accepted.
//
// EMBEDDED TAB/NEWLINE NOTE: this hook's own line format is tab-delimited, but neither the
// bash original nor this port escapes a tab/newline that happens to be embedded IN the
// summary content itself (e.g. a Bash command containing a literal tab byte, verified
// directly: it lands as a real 0x09 byte in the audit line, silently misaligning any
// naive `split('\t')` consumer). Preserved as-is — this is pre-existing bash behavior, not
// port-introduced, and D2 (behavior preservation) governs this hook; escaping would be a
// behavior change out of this iteration's scope.

import { readPayload, field, audit, runHook } from '../lib/common.mjs';

// bash: `head -c 240`, used identically for both the Bash-command summary and the default
// branch's compact tool_input summary.
const MAX_SUMMARY_BYTES = 240;

// Truncate a string to at most maxBytes UTF-8 bytes — see the file header's
// TRUNCATION-BOUNDARY NOTE for the byte-vs-code-unit rationale and the one documented
// divergence at a mid-character cut.
function truncateBytes(str, maxBytes) {
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  return buf.subarray(0, maxBytes).toString('utf8');
}

// bash: `jq -c '.tool_input // {}'` — compact JSON of tool_input, defaulting to `{}` when
// tool_input is null/missing/false (jq's `//` alternative fires only for null and false, per
// common.mjs's field() doc comment — NOT reused here, since field() collapses null/false to
// '' rather than '{}', the wrong default for this call site).
function compactToolInput(payload) {
  let value = payload && typeof payload === 'object' ? payload.tool_input : undefined;
  if (value === null || value === undefined || value === false) value = {};
  return JSON.stringify(value);
}

function main() {
  const payload = readPayload();
  const tool = field(payload, '.tool_name');
  if (!tool) return;

  let summary;
  switch (tool) {
    case 'Bash': {
      const cmd = truncateBytes(field(payload, '.tool_input.command'), MAX_SUMMARY_BYTES);
      summary = `cmd="${cmd}"`;
      break;
    }
    case 'Write':
    case 'Edit':
    case 'Read': {
      const filePath = field(payload, '.tool_input.file_path');
      summary = `path="${filePath}"`;
      break;
    }
    default:
      summary = truncateBytes(compactToolInput(payload), MAX_SUMMARY_BYTES);
  }

  audit(payload, 'CALL', summary);
}

runHook(main);
