// loop-diff.mjs -- the code loop's diff measurement: the weighted cumulative diff of the working tree against the
// loop's baseline, untracked files included.

import { measuredTree, treeNumstat } from './loop-review.mjs';

// Weighted cumulative diff vs baseline. Out-of-scope lines count double.
// Measured between the baseline and a snapshot tree of the whole working tree (tracked, staged and untracked
// files; .somi and .claude excluded), the same tree the review scope diffs, so the cap and the reviewer see one
// file set. A brand-new file is in the snapshot though git has never been told about it, and names are read
// NUL-separated, so no file is skipped for how it is spelled. When the tree cannot be measured this throws a
// refusal (exit 64) instead of returning a smaller diff.
export function computeDiff(root, baseline, iterationFiles) {
  const rows = treeNumstat(root, baseline, measuredTree(root));
  let total = 0;
  let weighted = 0;
  const outOfScope = [];
  for (const { added, deleted, file } of rows) {
    const lines = added + deleted;
    total += lines;
    let inScope = false;
    for (const entry of iterationFiles) {
      if (!entry) continue;
      if (file === entry || (entry.endsWith('/') && file.startsWith(entry))) {
        inScope = true;
        break;
      }
    }
    if (inScope) {
      weighted += lines;
    } else {
      weighted += 2 * lines;
      outOfScope.push(file);
    }
  }
  return { total, weighted, outOfScope };
}
