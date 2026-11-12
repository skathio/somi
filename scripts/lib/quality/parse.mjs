// quality/parse.mjs: the vendored tree-sitter runtime and grammars, checked against their manifest before use, and a parse with limits.
// The bytes that are hashed are the bytes that run: the runtime and each grammar are handed the verified buffer, not a path. A file
// that is too large, or that the parser cannot finish in time, comes back unanalyzed, and the gate counts that as a failure.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vendor', 'tree-sitter');
export const MAX_FILE_BYTES = 512 * 1024;
export const PARSE_TIMEOUT_MS = 5000;
const LANGUAGES = { '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx', '.css': 'css', '.cs': 'c-sharp', '.py': 'python' };

/** The grammar a file is parsed with, or null when the gate does not cover its language yet. */
export const languageOf = (file) => LANGUAGES[path.extname(file).toLowerCase()] ?? null;

let manifest = null;
let runtime = null;
const grammars = new Map();

/** The bytes of a vendored file, after checking them against the manifest in the same folder. */
export function verifiedFile(name, dir = DIR) {
  const list = dir === DIR ? (manifest ??= JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))) : JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const entry = list.files?.[name];
  if (!entry) throw new Error(`${name} is not in the vendored manifest`);
  const bytes = fs.readFileSync(path.join(dir, name));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`${name} does not match its manifest, so it is not loaded`);
  return bytes;
}

async function load(language) {
  if (!runtime) {
    verifiedFile('web-tree-sitter.js');
    const wasmBinary = verifiedFile('web-tree-sitter.wasm');
    const mod = await import(pathToFileURL(path.join(DIR, 'web-tree-sitter.js')).href);
    await mod.Parser.init({ wasmBinary });
    runtime = mod;
  }
  if (!grammars.has(language)) grammars.set(language, await runtime.Language.load(verifiedFile(`tree-sitter-${language}.wasm`)));
  const parser = new runtime.Parser();
  parser.setLanguage(grammars.get(language));
  return parser;
}

// Where the parser could not follow the code, as [first, last] lines. A grammar can lag a language's newest syntax, so an error far
// from a change does not stop the rest of the file being scored.
function errorRanges(tree) {
  const out = [];
  const visit = (n) => {
    if (n.isError || n.isMissing) { out.push([n.startPosition.row + 1, n.endPosition.row + 1]); return; }
    for (const c of n.children) if (c.hasError || c.isMissing) visit(c);
  };
  visit(tree.rootNode);
  return out;
}

/**
 * { tree, language, errors } for a supported file, { unanalyzed: reason } when it could not be parsed at all, or null for a language not
 * covered. errors lists the lines the parser could not follow, which the gate does not score.
 */
export async function parseSource(file, text) {
  const language = languageOf(file);
  if (!language) return null;
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) return { unanalyzed: `larger than ${MAX_FILE_BYTES} bytes` };
  const parser = await load(language);
  const deadline = Date.now() + PARSE_TIMEOUT_MS;
  try {
    const tree = parser.parse(text, null, { progressCallback: () => Date.now() > deadline });
    if (!tree) return { unanalyzed: `not parsed within ${PARSE_TIMEOUT_MS} ms` };
    return { tree, language, errors: tree.rootNode.hasError ? errorRanges(tree) : [] };
  } finally { parser.delete(); }
}
