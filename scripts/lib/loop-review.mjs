// loop-review.mjs -- what /code-loop's reviewer must see, decided from recorded state rather than from the
// reviewer's reading of evidence. Shared by scripts/somi-loop.mjs; no output of its own.

import { readRecord } from './tier-record.mjs';

// The sizing record decides the review lens: a work item that may handle untrusted input or touch auth, crypto,
// secrets or PII (security_lens in scripts/somi-tier.mjs's record) is reviewed with the security lens on every
// pass. No record, or a record without the flag, asks for nothing beyond the loop's configured mode.
export function reviewMinFor(root, slug) {
  return readRecord(root, slug)?.security_lens === true ? 'security' : null;
}
