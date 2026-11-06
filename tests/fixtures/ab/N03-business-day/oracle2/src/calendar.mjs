// SOMI-CANARY-N03-39d35df7f9c374df
export function wallDate(at, timeZone) {
  const map = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at))) map[type] = value;
  return map.year + '-' + map.month + '-' + map.day;
}
export function mondayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d);
  const offset = (new Date(asUtc).getUTCDay() + 6) % 7;
  return new Date(asUtc - offset * 86400000).toISOString().slice(0, 10);
}
