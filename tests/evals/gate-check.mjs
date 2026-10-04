// Release gate check (FR-16, FR-33, FR-35): may the committed definition set be released?
//
//   node tests/evals/gate-check.mjs --records <file> [--digest <64-hex>] [--baseline-tag <64-hex>|none]
//                                   [--genesis <64-hex>] [--head-anchor <64-hex>] [--repo <dir>]
//   node tests/evals/gate-check.mjs --help
//
// Output (stdout): the first line is always `<verdict>: <reason>`, printable ASCII only; a `ready` result
// adds `instrument_digest: <hex>` so a later check can compare it (nothing compares it here). Exit codes:
//   0  verdict is `ready` (the ONLY way to exit 0; gated on `verdict`, never on `code`), or --help
//   1  `not-ready` or `invalid` verdict, a dirty or unreadable git tree, or a git failure while finding the
//      baseline tag: all conditions a maintainer can fix, none of them a ready release
//   2  usage error, unreadable or malformed record store, a null from the library, an internal error
// Without --digest the digest is that of HEAD in --repo (default: this checkout), computed only after the
// definition-set tree is proven clean. Without --baseline-tag the baseline is the digest of the latest v*
// tag whose tree differs from the candidate's, or none; a git failure there is never read as none. Git is
// read-only and runs only through lib/definition-set.mjs; this file writes nothing and opens no socket (in a partial clone git itself may fetch missing objects).
//
// The release step passes only --records (plus --genesis and --head-anchor once they exist) and must require
// the first output line to start with `ready: ` as well as exit 0. --digest, --baseline-tag and --repo are
// diagnostics, not release inputs: a `ready` result produced with any of them prints `override:` and the
// comma-separated list of the ones used. With --digest but no --baseline-tag git still runs, to find the tag.
// Residuals: an unanchored forged store committed by a hostile branch reads `ready` until the release
// annotation anchors the verdict record; one hostile tag whose tree cannot be digested blocks every release
// (fail-closed denial of service for anyone who can land a merged tag). Wrapper residuals: a script that
// imports this file, `node -e "import(...)"` with no arguments and `node --import gate-check.mjs other.mjs`
// skip `main` and exit 0 silently; the release step must run tests/evals/gate-check.mjs directly and require
// the `ready: ` first line, which none of those produce.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVerdicts, readRecordsFile } from './lib/gate-check.mjs';
import { assertCleanTree, baselineTagDigest, definitionSetDigest } from './lib/definition-set.mjs';

const FLAGS = ['--records', '--digest', '--baseline-tag', '--genesis', '--head-anchor', '--repo'];
const HEX = /^[0-9a-f]{64}$/;
const USAGE = ['usage: node tests/evals/gate-check.mjs --records <file> [--digest <64-hex>] [--baseline-tag <64-hex>|none] [--genesis <64-hex>] [--head-anchor <64-hex>] [--repo <dir>]',
  'note: with --digest but no --baseline-tag, git still runs to find the baseline tag; --digest, --baseline-tag and --repo are diagnostics'];
export const clean = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').slice(0, 300);

// Every flag once, each followed by a value that is not itself flag-like; null on anything else.
function parse(args) {
  const o = Object.create(null);
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (!FLAGS.includes(flag) || flag in o || typeof value !== 'string' || value === '' || value.startsWith('-')) return null;
    if (flag !== '--records' && flag !== '--repo' && !HEX.test(value) && !(flag === '--baseline-tag' && value === 'none')) return null;
    o[flag] = value;
  }
  return o['--records'] === undefined ? null : o;
}

const bad = (why, code = 1) => [[`not-ready: ${clean(why)}`], code];

// The digest of HEAD after proof that the definition-set tree is clean, or a refusal `[lines, exitCode]`.
function headDigest(repo) {
  const tree = assertCleanTree(repo);
  if (tree === null) return [['invalid: bad repository argument'], 2];
  if (!tree.ok) return bad(tree.reason);
  return definitionSetDigest(repo, 'HEAD') ?? bad('git could not digest HEAD');
}

/** `[lines, exitCode]` for the argument list; the exit code is 0 only for a `ready` verdict or --help. */
export function run(args) {
  if (args.length === 1 && args[0] === '--help') return [USAGE, 0];
  const o = parse(args);
  if (!o) return [['invalid: usage error', ...USAGE], 2];
  const records = readRecordsFile(o['--records']);
  if (!records) return [['invalid: unreadable record store'], 2];
  const repo = o['--repo'] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  let digest = o['--digest'];
  if (digest === undefined) {
    // HEAD is read twice, each time after a clean-tree proof: a HEAD that moved in between is refused.
    const first = headDigest(repo);
    if (typeof first !== 'string') return first;
    const again = headDigest(repo);
    if (again !== first) return typeof again === 'string' ? bad('HEAD moved while the check ran') : again;
    digest = first;
  }
  let baselineTag = o['--baseline-tag'] === 'none' ? null : o['--baseline-tag'];
  if (baselineTag === undefined) {
    const found = baselineTagDigest(repo, digest);
    if (found === null) return [['invalid: bad repository argument'], 2];
    if (!found.ok) return bad(found.reason);
    baselineTag = found.digest;
  }
  const args2 = { records, digest, baselineTag };
  if (o['--genesis'] !== undefined) args2.genesisHash = o['--genesis'];
  if (o['--head-anchor'] !== undefined) args2.headAnchor = o['--head-anchor'];
  const result = checkVerdicts(args2);
  if (!result || typeof result.verdict !== 'string') return [['invalid: the verdict check rejected its arguments'], 2];
  const lines = [`${clean(result.verdict)}: ${clean(result.reason)}`];
  const used = [['digest', '--digest'], ['baseline-tag', '--baseline-tag'], ['repo', '--repo']].filter(([, f]) => o[f] !== undefined).map(([n]) => n);
  if (result.verdict === 'ready' && used.length > 0) lines.push(`override: ${used.join(',')}`);
  const inst = result.verdict === 'ready' ? records[result.record]?.instrument_digest : null;
  if (typeof inst === 'string' && HEX.test(inst)) lines.push(`instrument_digest: ${inst}`);
  return [lines, result.verdict === 'ready' ? 0 : 1];
}

// Is this file the main module? The paths are compared after realpath: Node resolves import.meta.url through
// symlinks while argv[1] keeps the path as typed, and a false answer would mean exit 0 with no output. A
// missing argv[1] (an import from `-e`) counts as not main. If the comparison itself throws, the file acts
// as main, so that failure can only produce output and a non-zero exit.
function isMain() {
  try {
    return typeof process.argv[1] === 'string' && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
}
const isMainModule = isMain();

if (isMainModule) {
  let [lines, code] = [['invalid: internal error'], 2];
  try {
    [lines, code] = run(process.argv.slice(2));
  } catch { /* the defaults above stand: a crash is never a pass */ }
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = code;
}
