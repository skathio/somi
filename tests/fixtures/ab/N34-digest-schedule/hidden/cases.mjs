// SOMI-CANARY-N34-3e68521e8d65af8a
const load = async (l) => (await l('src/schedule.mjs')).nextRun;
const U = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const run = (after, time, zone) => async (l) => (await load(l))(after, { time, zone });
const code = (time, zone) => async (l) => { try { (await load(l))(U(2026, 6, 1), { time, zone }); return null; } catch (e) { return [e.status, e.code]; } };
const iso = (f) => async (l) => new Date(await f(l)).toISOString();
const when = (after, time, zone, expected) => ({ run: iso(run(after, time, zone)), expect: new Date(expected).toISOString() });
export const cases = [
  { name: 'AC2 [functional] a run later today, in summer', ...when(U(2026, 7, 1, 10), '09:00', 'America/New_York', U(2026, 7, 1, 13)) },
  { name: 'AC2 [functional] tomorrow, once today has passed', ...when(U(2026, 7, 1, 14), '09:00', 'America/New_York', U(2026, 7, 2, 13)) },
  { name: 'AC2 [functional] a zone on the half hour', ...when(U(2026, 1, 10), '09:00', 'Asia/Kolkata', U(2026, 1, 10, 3, 30)) },
  { name: 'AC2 [functional] the local date is not the UTC date', ...when(U(2026, 7, 1, 23), '07:00', 'Asia/Tokyo', U(2026, 7, 1, 22).valueOf() + 86400000) },
  { name: 'AC2 [boundary] the same local hour on the day the clocks go forward', ...when(U(2026, 3, 7, 15), '09:00', 'America/New_York', U(2026, 3, 8, 13)) },
  { name: 'AC2 [boundary] the same local hour on the day the clocks go back', ...when(U(2026, 10, 31, 14), '09:00', 'America/New_York', U(2026, 11, 1, 14)) },
  { name: 'AC2 [boundary] the southern hemisphere changes the other way', ...when(U(2026, 10, 3, 1), '09:00', 'Australia/Sydney', U(2026, 10, 3, 22)) },
  { name: 'AC2 [boundary] exactly at a run, the next one is tomorrow', ...when(U(2026, 7, 1, 13), '09:00', 'America/New_York', U(2026, 7, 2, 13)) },
  { name: 'AC3 [boundary] a skipped time goes out when the clocks have gone forward', ...when(U(2026, 3, 8, 1), '02:30', 'America/New_York', U(2026, 3, 8, 7)) },
  { name: 'AC3 [boundary] after a skipped time, the next day is normal', ...when(U(2026, 3, 8, 7), '02:30', 'America/New_York', U(2026, 3, 9, 6, 30)) },
  { name: 'AC3 [boundary] a time that happens twice goes out at the first', ...when(U(2026, 11, 1, 1), '01:30', 'America/New_York', U(2026, 11, 1, 5, 30)) },
  { name: 'AC3 [boundary] and not at the second', ...when(U(2026, 11, 1, 5, 40), '01:30', 'America/New_York', U(2026, 11, 2, 6, 30)) },
  { name: 'AC3 [boundary] a change of half an hour, going forward', ...when(U(2026, 10, 3, 12), '02:15', 'Australia/Lord_Howe', U(2026, 10, 3, 15, 30)) },
  { name: 'AC3 [boundary] a change of half an hour, going back', ...when(U(2026, 4, 4, 12), '01:45', 'Australia/Lord_Howe', U(2026, 4, 4, 14, 45)) },
  { name: 'AC3 [boundary] a change at midnight, where the date is what moves', ...when(U(2026, 3, 8, 1), '00:30', 'America/Havana', U(2026, 3, 8, 5)) },
  { name: 'AC3 [boundary] a whole skipped day still gets its digest', ...when(U(2011, 12, 29, 22), '09:00', 'Pacific/Apia', U(2011, 12, 30, 10)) },
  { name: 'AC4 [functional] an unknown zone is refused', run: code('09:00', 'Mars/Olympus'), expect: [400, 'invalid_zone'] },
  { name: 'AC4 [boundary] a time that is not on the clock is refused', run: async (l) => [await code('24:00', 'UTC')(l), await code('9:5', 'UTC')(l), await code('12:60', 'UTC')(l)], expect: [[400, 'invalid_time'], [400, 'invalid_time'], [400, 'invalid_time']] },
];
