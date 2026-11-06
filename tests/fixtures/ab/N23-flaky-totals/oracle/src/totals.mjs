// SOMI-CANARY-N23-a087c4c53cbe8bd5
export async function regionTotals(rows, fetchRate) {
  const totals = {};
  await Promise.all(rows.map(async (row) => {
    const rate = await fetchRate(row.currency);
    totals[row.region] = (totals[row.region] ?? 0) + row.cents * rate;
  }));
  return Object.keys(totals).sort().map((region) => ({ region, total: Math.round(totals[region]) }));
}

export function topRegions(rows, n) {
  const ranked = [...rows].sort((a, b) => b.total - a.total || (a.region < b.region ? -1 : 1));
  return ranked.slice(0, n);
}
