export async function regionTotals(rows, fetchRate) {
  const totals = {};
  await Promise.all(rows.map(async (row) => {
    const before = totals[row.region] ?? 0;
    const rate = await fetchRate(row.currency);
    totals[row.region] = before + row.cents * rate;
  }));
  return Object.entries(totals).map(([region, total]) => ({ region, total: Math.round(total) }));
}

export function topRegions(rows, n) {
  rows.sort((a, b) => (b.total > a.total ? 1 : -1));
  return rows.slice(0, n);
}
