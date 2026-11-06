// SOMI-CANARY-N25-631bbc4948e55d2c
const at = (iso) => Date.parse(iso);
const S = (user, n, nowIso) => async (l) => new Date((await l('src/schedule.mjs')).sendTime(user, n, at(nowIso))).toISOString();
const NY = { id: 'u', timeZone: 'America/New_York' };
const iso = (s) => new Date(at(s)).toISOString();
const plain = { id: 'n' };
export const cases = [
  { name: 'AC2 [functional] daytime on their clock goes at once', run: S(NY, plain, '2025-03-14T16:00:00Z'), expect: iso('2025-03-14T16:00:00Z') },
  { name: 'AC2 [functional] night on their clock waits until 08:00 there', run: S(NY, plain, '2025-03-14T04:00:00Z'), expect: iso('2025-03-14T12:00:00Z') },
  { name: 'AC2 [functional] it is their clock and not the server clock', run: S({ id: 'u', timeZone: 'Asia/Tokyo' }, plain, '2025-06-01T14:30:00Z'), expect: iso('2025-06-01T23:00:00Z') },
  { name: 'AC2 [boundary] before midnight waits for the next morning', run: S(NY, plain, '2025-06-02T03:00:00Z'), expect: iso('2025-06-02T12:00:00Z') },
  { name: 'AC2 [boundary] the start is inside the quiet time', run: S(NY, plain, '2025-06-02T02:00:00Z'), expect: iso('2025-06-02T12:00:00Z') },
  { name: 'AC2 [boundary] the end is outside the quiet time', run: async (l) => new Date((await l('src/schedule.mjs')).sendTime(NY, plain, at('2025-06-02T12:00:00Z'))).toISOString(), expect: iso('2025-06-02T12:00:00Z') },
  { name: 'AC2 [boundary] no zone counts as UTC', run: S({ id: 'u' }, plain, '2025-06-02T23:30:00Z'), expect: iso('2025-06-03T08:00:00Z') },
  { name: 'AC2 [functional] their own hours replace the default', run: S({ ...NY, quiet: { start: '13:00', end: '15:00' } }, plain, '2025-06-02T18:00:00Z'), expect: iso('2025-06-02T19:00:00Z') },
  { name: 'AC2 [functional] outside their own hours goes at once, even at night', run: S({ ...NY, quiet: { start: '13:00', end: '15:00' } }, plain, '2025-06-02T07:00:00Z'), expect: iso('2025-06-02T07:00:00Z') },
  { name: 'AC2 [functional] their own hours may cross midnight', run: S({ ...NY, quiet: { start: '23:30', end: '06:15' } }, plain, '2025-06-02T04:00:00Z'), expect: iso('2025-06-02T10:15:00Z') },
  { name: 'AC2 [functional] quiet hours turned off go at once', run: S({ ...NY, quiet: null }, plain, '2025-06-02T04:00:00Z'), expect: iso('2025-06-02T04:00:00Z') },
  { name: 'AC2 [boundary] clocks going forward overnight still wake at 08:00 there', run: S(NY, plain, '2025-03-09T05:00:00Z'), expect: iso('2025-03-09T12:00:00Z') },
  { name: 'AC2 [boundary] clocks going back overnight still wake at 08:00 there', run: S(NY, plain, '2025-11-02T04:30:00Z'), expect: iso('2025-11-02T13:00:00Z') },
  { name: 'AC2 [functional] urgent goes at once', run: S(NY, { id: 'n', urgent: true }, '2025-06-02T04:00:00Z'), expect: iso('2025-06-02T04:00:00Z') },
  { name: 'AC2 [functional] a security notice counts as urgent whatever it is marked', run: S(NY, { id: 'n', kind: 'security', urgent: false }, '2025-06-02T04:00:00Z'), expect: iso('2025-06-02T04:00:00Z') },
  { name: 'AC3 [regression] what is due still works', run: async (l) => (await l('src/schedule.mjs')).dueNow([{ at: 1 }, { at: 3 }], 2), expect: [{ at: 1 }] },
];
