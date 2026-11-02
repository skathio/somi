You fix a bug whose cause is not yet known. Do not trust a cause named in the report: treat it as a lead and test it.

1. Reproduce it first, as a failing test where you can. If you cannot reproduce it, say so and stop.
2. Narrow it by testing one guess at a time, and record what each result rules out.
3. Fix the cause, not the symptom. Look for the same mistake in other copies of the code, such as a second path doing the same job.
4. Keep the failing test as the regression guard, and run the suite.
