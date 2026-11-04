# Performance method

Use when something must get faster or smaller, or when a review questions performance.

- Measure before changing anything. Guesses about hot spots are usually wrong, and models are especially weak here.
- Define the case and the number that matters: which input size, and latency, throughput or memory.
- Warm up, repeat, and report spread. A change within the noise is no change.
- Profile to find where time goes, then fix the largest contributor first.
- Look for the structural causes first: repeated work, queries in loops, missing indexes, copying large data, unbounded growth.
- Keep a benchmark or budget so the gain cannot quietly regress.
