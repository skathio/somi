// path-safety.mjs — inspectPath(root, raw): may a script look at this model-named path?
//
// A model, steered by request text, names paths; this module is the only door between those names and the
// filesystem. It returns a result by class, never file content:
//   { kind: 'denied' }                      the NAME is a secret (.env*, key and certificate files, .git/): decided
//                                           on the string alone, no lstat, no realpath, no open, whatever the
//                                           file's state, so nothing can be learned about it
//   { kind: 'refused', refusal, denied? }   unsafe or unreadable; `refusal` is one of REFUSAL_IDS (ASCII, never
//                                           the input text); `denied: true` when the name is also deny-listed,
//                                           so a malformed secret name (../../.env) keeps its floor
//   { kind: 'contained', exists, rel, ... } inside the root: a plain file (exists: true, with its size, and
//                                           `answer` when a probe was given) or a new path whose parent exists
// `rel` is the caller's own text and may be non-ASCII; the output layer escapes it. A name over MAX_PATH_CHARS is
// never normalised or judged: it counts as deny-listed, so it is refused `path_length` with `denied: true`.
// Backslashes are separators everywhere here, so `a\..\b` is a traversal on every platform.
//
// A probe is called with the open descriptor and the size, and returns true or false; this module closes the
// descriptor, so it never escapes. This module returns only that boolean, so the probe must be synchronous; a
// probe that throws becomes the `probe` refusal, never its message. The probe must not close the descriptor: a
// probe that does makes this module's own close fail, which is the `probe` refusal too (a close that fails with no probe is `unreadable`).
//
// Seams: `realpath` (default fs.realpathSync.native) and `constants` (default fs.constants).
// shortcut: containment is checked, then the file is opened by its canonical path; a directory swapped in
// between the walk and the open by a process already running as the user is not defended (O_NOFOLLOW covers the
// last component), upgrade when the script runs for a different user than the files' owner.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_PATHS = 40;
export const MAX_PATH_CHARS = 240;
export const MAX_FILE_BYTES = 1024 * 1024;

export const REFUSAL_IDS = Object.freeze([
  'malformed', 'path_count', 'path_length', 'control', 'absolute', 'traversal', 'symlink', 'escape',
  'no_parent', 'not_file', 'file_size', 'platform', 'unreadable', 'probe',
]);

const SEPARATORS = /[\\/]+/;
// Cf includes ZWNJ and ZWJ: refusing them (they matter in some scripts) is deliberate, a hidden join is a spoof.
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const ABSOLUTE = /^(?:[\\/]|[a-z]:)/i;
const PARENT_SEGMENT = /^\.{2}[. ]*$/;
// A bare `config` is allowed on purpose, though the secret-write hook denies it: this match is per segment, so `config`
// here would deny every `config/` directory. The secret-bearing configs sit under the `.git`, `.ssh`, `.aws`, `.kube`
// and `.docker` segments below. `credentials` also denies a `credentials/` directory, which the hook (basename only) does not.
const NAME_EXACT = ['.git', '.ssh', '.gnupg', '.aws', '.kube', '.docker', 'credentials'];
const NAME_PREFIXES = ['.env', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.npmrc', '.netrc', '.git-credentials', '.pypirc', '.pgpass', 'terraform.tfstate', '_netrc', '_pgpass', '.htpasswd', '.vault-token'];
const NAME_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der', '.jks', '.keystore', '.ppk', '.tfvars', '.kdbx', '.tfstate', '.tfstate.backup', '.p8', '.netrc', '.pgpass', '-key.json', 'credentials.json'];
// Names the repository's own secret-write hook denies by pattern rather than by affix, and the common service-account
// and OAuth client key files it does not name: the exact `key.json` (the GCP docs' default) and a `.tfstate.<n>.backup` copy.
const NAME_PATTERN = /service[-_]?account.*\.json$|client_secret.*\.json$|secrets?\.(?:ya?ml|json)$|^key\.json$|\.tfstate\..*\.backup$/;

const segmentsOf = (raw) => raw.split(SEPARATORS).filter((s) => s !== '' && s !== '.');
const trimDots = (s) => { let e = s.length; while (e > 0 && (s[e - 1] === '.' || s[e - 1] === ' ')) e--; return s.slice(0, e); };
const refused = (refusal, denied = false) => (denied ? { kind: 'refused', refusal, denied: true } : { kind: 'refused', refusal });

// Pure string test, case-folded (upper then lower, so a sharp s reads as ss): the same answer for .ENV as .env on every filesystem.
// The raw path is split first and each segment folded after, because seven code points fold to a separator (U+FF0F,
// U+FF3C, U+FE68, U+2100, U+2101, U+2105, U+2106): a segment is tested whole and as its re-split pieces (a union), so
// `x／.env` and `service-account／prod.json` are both denied.
export function denyListed(raw) {
  if (typeof raw !== 'string') return false;
  if (raw.length > MAX_PATH_CHARS) return true;
  return raw.split(SEPARATORS).some((segment) => {
    const folded = segment.normalize('NFKC').toUpperCase().toLowerCase();
    return [...new Set([folded, ...folded.split(SEPARATORS)])].some((piece) => {
      const name = trimDots(piece);
      return NAME_EXACT.includes(name) || /~\d/.test(name) || name.includes(':') || NAME_PATTERN.test(name) || NAME_PREFIXES.some((p) => name.startsWith(p)) || NAME_SUFFIXES.some((s) => name.endsWith(s));
    });
  });
}

// The list-level cap. A list over it is refused whole and keeps the deny-listed fact for any name in it; a list over
// 4 x MAX_PATHS is not scanned at all and is refused as denied outright.
export function refuseList(paths) {
  if (!Array.isArray(paths)) return refused('malformed');
  if (paths.length <= MAX_PATHS) return null;
  if (paths.length > 4 * MAX_PATHS) return refused('path_count', true); // not scanned: a list this long is hostile
  return refused('path_count', paths.some(denyListed));
}

function malformed(raw) {
  if (typeof raw !== 'string') return 'malformed';
  if (raw.length > MAX_PATH_CHARS) return 'path_length';
  if (UNSAFE_CHARS.test(raw)) return 'control';
  if (ABSOLUTE.test(raw)) return 'absolute';
  const segments = segmentsOf(raw);
  if (segments.some((s) => PARENT_SEGMENT.test(s))) return 'traversal';
  return segments.length === 0 ? 'malformed' : null;
}

// Walks the root downwards one component at a time; any symlink refuses. Returns the canonical path and
// whether it exists, or a result to hand back.
function locate(root, segments, realpath) {
  const base = realpath(root);
  let current = base;
  for (let i = 0; i < segments.length; i++) {
    const next = path.join(current, segments[i]);
    let stat;
    try {
      stat = fs.lstatSync(next);
    } catch (e) {
      if (e.code !== 'ENOENT') return { result: refused('unreadable') };
      if (i < segments.length - 1) return { result: refused('no_parent') };
      return { base, real: path.join(realpath(current), segments[i]), exists: false };
    }
    if (stat.isSymbolicLink()) return { result: refused('symlink') };
    if (i < segments.length - 1 && !stat.isDirectory()) return { result: refused('not_file') };
    if (i === segments.length - 1 && !stat.isFile()) return { result: refused('not_file') };
    current = next;
  }
  return { base, real: realpath(current), exists: true };
}

// Opens without following a link or blocking on a FIFO; returns the descriptor and size, or a result.
function openPlainFile(real, constants) {
  let fd;
  try {
    fd = fs.openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (constants.O_NOCTTY ?? 0));
  } catch (e) {
    return { result: refused(e.code === 'ELOOP' ? 'symlink' : 'unreadable') };
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw Object.assign(new Error(), { refusal: 'not_file' });
    if (stat.size > MAX_FILE_BYTES) throw Object.assign(new Error(), { refusal: 'file_size' });
    return { fd, size: stat.size };
  } catch (e) {
    fs.closeSync(fd);
    return { result: refused(e.refusal ?? 'unreadable') };
  }
}

export function inspectPath(root, raw, probe = null, { realpath = fs.realpathSync.native, constants = fs.constants } = {}) {
  const denied = denyListed(raw);
  const bad = malformed(raw);
  if (bad) return refused(bad, denied);
  if (denied) return { kind: 'denied' };
  if (!(constants.O_NOFOLLOW > 0 && constants.O_NONBLOCK > 0)) return refused('platform');
  let found;
  try {
    found = locate(root, segmentsOf(raw), realpath);
  } catch {
    return refused('unreadable');
  }
  if (found.result) return found.result;
  const rel = path.relative(found.base, found.real);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return refused('escape');
  if (denyListed(rel)) return { kind: 'denied' };
  const contained = { kind: 'contained', exists: found.exists, rel: rel.split(path.sep).join('/') };
  if (!found.exists) return contained;
  const opened = openPlainFile(found.real, constants);
  if (opened.result) return opened.result;
  let result = contained;
  try {
    contained.size = opened.size;
    if (probe) contained.answer = probe(opened.fd, opened.size) === true;
  } catch {
    result = refused('probe');
  }
  try {
    fs.closeSync(opened.fd);
  } catch {
    return refused(probe ? 'probe' : 'unreadable'); // with a probe, the likely cause is the probe closing the descriptor
  }
  return result;
}
