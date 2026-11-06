# recur

A small library for recurring calendar schedules (meetings, billing dates, reminders). Run the tests with `npm test`.

```js
import { occurrences, occursOn } from './src/index.mjs';

const standup = { freq: 'weekly', byWeekday: ['mon', 'thu'], start: '2025-03-03' };
occurrences(standup, { to: '2025-03-14' }); // ['2025-03-03', '2025-03-06', '2025-03-10', '2025-03-13']
occursOn(standup, '2025-03-06');            // true
```

## Conventions

- A day is a string `YYYY-MM-DD`, a real calendar date from 1900 to 2100. The library works on calendar days only: no times,
  no time zones, and the result never depends on the machine's clock or zone.
- Weekdays are `sun mon tue wed thu fri sat`.
- Invalid input throws a `RuleError` with a stable `code`: `invalid_rule`, `invalid_freq`, `invalid_interval`, `invalid_date`,
  `invalid_weekday`, `invalid_month_day`, `invalid_end`, `invalid_option`, `invalid_limit`.
- The functions are pure; a rule object is never changed.

## Rules

| Field | Meaning |
| --- | --- |
| `freq` | `daily`, `weekly`, `monthly` or `yearly`. |
| `start` | The first day the rule can fall on; required. |
| `interval` | Every n-th day, week, month or year, counted from `start` (default 1, 1 to 1000). |
| `count` | The rule ends after this many days (counted from `start`, not from the window asked for). |
| `until` | The rule ends after this day, which is included. |
| `byWeekday` | Weekly only: the weekdays to use. Default: the weekday of `start`. |
| `weekStart` | Weekly only: the first day of the week. Default `mon`. |
| `byMonthDay` | Monthly only: days of the month, 1 to 31, or `-1` for the last day. Default: the day of the month of `start`. |

Weekly rules with an `interval` above 1 use every n-th **week**, counted from the week that contains `start`. A week runs
from `weekStart` to the day before the next `weekStart`; days of that first week before `start` are not days of the rule.

A month day that the month does not have falls on the last day of that month (the 31st in April is the 30th, the 29th of
February in a common year is the 28th), and the next month starts over from the wanted day. A yearly rule starting on
29 February behaves the same way.

## Functions

### `occurrences(rule, { from, to, limit })`

The days of the rule inside the window, ascending. `from` and `to` are inclusive; `from` defaults to `start`, `to` to the end
of the supported years. `limit` defaults to 100 (1 to 1000).

### `occursOn(rule, day)`

`true` exactly when `day` is one of the days `occurrences` would list for the rule.
