// SOMI-CANARY-N03-39d35df7f9c374df
const R = (load) => load('src/reports.mjs');
const O = (at, amount = 1) => ({ at, amount });
export const cases = [
  { name: 'AC2 [functional] an evening order on the last day stays in the month', run: async (load) => (await R(load)).dailyReport([O('2025-02-01T03:00:00Z', 7)], 2025, 1)['2025-01-31'], expect: 7 },
  { name: 'AC2 [functional] that order is not counted in the next month', run: async (load) => (await R(load)).dailyReport([O('2025-02-01T03:00:00Z', 7)], 2025, 2)['2025-02-01'], expect: 0 },
  { name: 'AC2 [boundary] the day boundary moves with daylight saving', run: async (load) => { const r = (await R(load)).dailyReport([O('2025-07-01T03:30:00Z', 1), O('2025-07-01T04:30:00Z', 2)], 2025, 6); return r['2025-06-30']; }, expect: 1 },
  { name: 'AC2 [boundary] after the clocks change it moves back', run: async (load) => { const r = (await R(load)).dailyReport([O('2025-12-01T04:30:00Z', 1), O('2025-12-01T05:30:00Z', 2)], 2025, 11); return r['2025-11-30']; }, expect: 1 },
  { name: 'AC2 [boundary] both ends of a period are included', run: async (load) => (await R(load)).periodTotal([O('2025-03-01T06:00:00Z', 1), O('2025-03-02T04:30:00Z', 2), O('2025-03-02T05:30:00Z', 4), O('2025-03-03T04:59:00Z', 8)], '2025-03-01', '2025-03-02'), expect: 15 },
  { name: 'AC2 [boundary] a period uses the shop clock at its start', run: async (load) => (await R(load)).periodTotal([O('2025-03-01T04:00:00Z', 1), O('2025-03-01T06:00:00Z', 2)], '2025-03-01', '2025-03-01'), expect: 2 },
  { name: 'AC2 [functional] a Sunday evening order belongs to the week before', run: async (load) => (await R(load)).weeklyReport([O('2025-03-10T02:00:00Z', 3)]), expect: { '2025-03-03': 3 } },
  { name: 'AC2 [functional] the zone argument is honoured by each report', run: async (load) => { const m = await R(load); const o = [O('2025-03-10T02:00:00Z', 3)]; return { week: m.weeklyReport(o, 'Asia/Tokyo'), day: m.dailyReport(o, 2025, 3, 'Asia/Tokyo')['2025-03-10'], period: m.periodTotal(o, '2025-03-10', '2025-03-10', 'Asia/Tokyo') }; }, expect: { week: { '2025-03-10': 3 }, day: 3, period: 3 } },
  { name: 'AC3 [regression] a month keeps all its days', run: async (load) => Object.keys((await R(load)).dailyReport([], 2024, 2)).length, expect: 29 },
];
