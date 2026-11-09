# CI and infrastructure gotchas

Use when changing CI, containers, deployment manifests or infrastructure config.

Examples in your memory are often an older version, and copying a near match does harm. First read which version this project runs and that version's own docs, then copy nothing you have not checked against them.

- Add only what was asked for. An extra policy or resource you were not asked for is a regression.
- Pin third-party actions and images by digest or commit, because tags can be moved.
- Give CI tokens the least permission, per job. Never expose secrets to code from forks.
- A step that masks its exit status hides failure: check pipes and `|| true`.
- Validate with the tool's own dry run or schema check before you say it works.
- Caches must key on what changes the result, or they serve stale output.
