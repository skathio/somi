# Benchmark record: aa

- Session model: claude-sonnet-5-5, low tier claude-haiku-5-5
- Rule hash: 44ddb986add1733649ad1c5ffd01b0d0782b6b6c997d1f3ebc0c9ecf059034d3
- Host: {"cpu":"Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz","cores":8,"memGb":15,"os":"6.8.0-147-generic","node":"v26.2.0"}
- Draws recorded: 96 of 96. Dollars are the CLI's estimate.

## Arms

| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |
|---|---|---|---|---|---|---|---|---|
| bare-a | 48 | 40 | 0.75 | 0.69 | 49881 | 0.107 | 0.6 | {"finished":48} |
| bare-b | 48 | 42 | 0.88 | 0.75 | 47291 | 0.101 | 0.5 | {"finished":48} |

## Against bare-a

Ratios are per draw, blocked by task, with a 90% interval.

| Arm | Weighted tokens | Dollars | Wall time |
|---|---|---|---|
| bare-b | 0.99 (0.95 to 1.04) | 1.00 (0.96 to 1.04) | 1.01 (0.97 to 1.06) |

## Noise floor

A/A difference -0.04 (95% -0.15 to 0.07), contains zero. Tokens: 1.01 (0.96 to 1.06).

## Protocol and spend

| Arm | Routed to | Tool or CLI | Closed | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bare-a | {} | {"none":48} | 0 | 0.00 | {} | 0 | 0 | {} | {"claude-sonnet-5-5":0.0889} | {"main":41567} | 1.00 |
| bare-b | {} | {"none":48} | 0 | 0.00 | {} | 0 | 1 | {} | {"claude-sonnet-5-5":0.0888} | {"main":41380} | 1.00 |

## Reading

The instrument holds. Two bare arms on the same tasks solved 40 and 42 of 48, and the interval on the difference runs from -0.152 to 0.068, so it contains zero. Any gap smaller than that between two arms at this draw count is noise.
