// brief-own.mjs: whether the brief on disk is the user's own. A brief is the user's approval of work, and its test command is run by the
// staged workflow, so a brief a repository ships is never built from, saved over or deleted.

import fs from 'node:fs';
import path from 'node:path';
import { briefIsTracked } from './git-tree.mjs';

const TRACKED = 'it, or .somi itself, is committed to this repository, so it is not a brief the user approved. Stop tracking it with `git rm --cached`.';
const LINKED = '.somi is a link, so the brief behind it may be a file the repository ships. Replace the link with a folder of your own.';
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
// Why a brief on disk is not the user's own, or null when it is. A repository can commit the file itself, or commit .somi as a link to a
// folder of its own, where git does not see the file under .somi at all.
export const notOwn = (root) => (isLink(path.join(root, '.somi')) ? LINKED : briefIsTracked(root) ? TRACKED : null);
