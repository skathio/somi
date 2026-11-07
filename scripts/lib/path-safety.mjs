// path-safety.mjs — the deny list: which path names are secrets (.env*, key and certificate files, .git/ and the like),
// decided on the string alone, with no lstat, realpath or open, so nothing can be learned about the file. The review and
// security signals and path-facts read names through it, so every caller folds and splits a name the same way.
// A name over MAX_PATH_CHARS is never normalised or judged: it counts as deny-listed. Backslashes are separators
// everywhere here, so `a\..\b` splits the same way on every platform.

export const MAX_PATHS = 40;
export const MAX_PATH_CHARS = 240;
// The largest file a script reads whole: the quality gate's parser, migrations and the eval task store share it.
export const MAX_FILE_BYTES = 1024 * 1024;

const SEPARATORS = /[\\/]+/;
// A bare `config` is allowed on purpose, though the secret-write hook denies it: this match is per segment, so `config`
// here would deny every `config/` directory. The secret-bearing configs sit under the `.git`, `.ssh`, `.aws`, `.kube`
// and `.docker` segments below. `credentials` also denies a `credentials/` directory, which the hook (basename only) does not.
const NAME_EXACT = ['.git', '.ssh', '.gnupg', '.aws', '.kube', '.docker', 'credentials'];
const NAME_PREFIXES = ['.env', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.npmrc', '.netrc', '.git-credentials', '.pypirc', '.pgpass', 'terraform.tfstate', '_netrc', '_pgpass', '.htpasswd', '.vault-token'];
const NAME_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der', '.jks', '.keystore', '.ppk', '.tfvars', '.kdbx', '.tfstate', '.tfstate.backup', '.p8', '.netrc', '.pgpass', '-key.json', 'credentials.json'];
// Names the repository's own secret-write hook denies by pattern rather than by affix, and the common service-account
// and OAuth client key files it does not name: the exact `key.json` (the GCP docs' default) and a `.tfstate.<n>.backup` copy.
// `[^]*`, not `.*`: a line terminator in the middle of a name must not stop the match (`.` does not match one).
const NAME_PATTERN = /service[-_]?account[^]*\.json$|client_secret[^]*\.json$|secrets?\.(?:ya?ml|json)$|^key\.json$|\.tfstate\.[^]*\.backup$/;

export const trimDots = (s) => { let e = s.length; while (e > 0 && (s[e - 1] === '.' || s[e - 1] === ' ')) e--; return s.slice(0, e); };

// The fold every name test shares (case, compatibility forms): callers that read names the way the deny list does import it.
export const foldName = (s) => s.normalize('NFKC').toUpperCase().toLowerCase();

// Pure string test, case-folded (upper then lower, so a sharp s reads as ss): the same answer for .ENV as .env on every filesystem.
// The raw path is split first and each segment folded after, because seven code points fold to a separator (U+FF0F,
// U+FF3C, U+FE68, U+2100, U+2101, U+2105, U+2106): a segment is tested whole and as its re-split pieces (a union), so
// `x／.env` and `service-account／prod.json` are both denied.
export function denyListed(raw) {
  if (typeof raw !== 'string') return false;
  if (raw.length > MAX_PATH_CHARS) return true;
  return raw.split(SEPARATORS).some((segment) => {
    const folded = foldName(segment);
    return [...new Set([folded, ...folded.split(SEPARATORS)])].some((piece) => {
      const name = trimDots(piece);
      return NAME_EXACT.includes(name) || /~\d/.test(name) || name.includes(':') || NAME_PATTERN.test(name) || NAME_PREFIXES.some((p) => name.startsWith(p)) || NAME_SUFFIXES.some((s) => name.endsWith(s));
    });
  });
}
