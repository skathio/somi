# Testing checklist

Use when writing or judging tests for a change, especially one with edge cases that are easy to skip.

Before you call it done, check each that applies, and add a test where it matters:

- The test fails without the change. Run it that way once if it is cheap.
- Boundaries: zero, one, empty, the maximum, just past the maximum, and inclusive against exclusive ends.
- Bad input: wrong type, missing field, and the documented error for each.
- Repeats: doing it twice, retrying after a failure, and two at once if it can happen.
- All-or-nothing: after a failure midway, nothing is left half done.
- Time and zones: daylight saving changes, month ends, and expiry at the exact moment.
- Money and rounding: whole units, ties, and totals that must add up exactly.
- What must not change: other callers, other users' data, and existing output.

Assert behaviour, not how it is built. Do not mock what you do not own. Use the framework and style the project already uses. This list says what to cover, not how to write it.
