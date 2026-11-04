// SOMI-CANARY-N23-a087c4c53cbe8bd5
export async function regionTotals(rows, fetchRate) {
  const currencies = [...new Set(rows.map((r) => r.currency))];
  const rates = new Map(await Promise.all(currencies.map(async (c) => [c, await fetchRate(c)])));
  const sums = new Map();
  for (const r of rows) sums.set(r.region, (sums.get(r.region) ?? 0) + r.cents * rates.get(r.currency));
  return [...sums.keys()].sort().map((region) => ({ region, total: Math.round(sums.get(region)) }));
}

export function topRegions(rows, n) {
  return rows.map((r) => r).sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    return a.region.localeCompare(b.region);
  }).slice(0, n);
}
