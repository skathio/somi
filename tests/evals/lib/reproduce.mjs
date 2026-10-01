#!/usr/bin/env node
// Executes task 03 criterion 3 instead of judging it.
//
// The criterion already reads as an executable assertion -- "the cited case must GENUINELY fail" --
// and a judged version asks a model to do arithmetic it can get wrong in the same direction the
// candidate did. Running it costs nothing and cannot disagree with itself.
//
// FAILS SAFE. If no date can be extracted, this returns `null` and the caller falls back to the
// judge. A parser that returned `false` on an unrecognised phrasing would fail correct reviews for
// citing a case in a form nobody anticipated -- the "criterion that fails a conforming run" this
// corpus keeps rediscovering.

const ISO = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
const MONTH_NAMES = 'january february march april may june july august september october november december'.split(' ');
const NAMED = new RegExp(`\\b(${MONTH_NAMES.join('|')})\\s+(\\d{1,2})(?:\\w{0,2})?(?:,?\\s*(20\\d{2}))?`, 'gi');

/** Every date the review text cites, as UTC Dates. */
export function citedDates(text) {
  const out = [];
  for (const m of text.matchAll(ISO)) {
    out.push(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  }
  for (const m of text.matchAll(NAMED)) {
    const mo = MONTH_NAMES.indexOf(m[1].toLowerCase());
    out.push(new Date(Date.UTC(m[3] ? +m[3] : 2026, mo, +m[2])));
  }
  return out.filter((d) => !Number.isNaN(d.getTime()));
}

/**
 * Does any cited date actually reproduce the defect?
 *
 * @returns {true|false|null} null = no date cited, fall back to the judge
 */
export function reproduces(reviewText, { correct, patched }) {
  const dates = citedDates(reviewText);
  if (dates.length === 0) return null;
  return dates.some((d) => {
    try {
      return correct(1000, 2000, d).net !== patched(1000, 2000, d).net;
    } catch {
      return false;
    }
  });
}
