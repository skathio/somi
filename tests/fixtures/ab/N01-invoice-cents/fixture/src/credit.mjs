export function buildCreditNote(lines) {
  let net = 0;
  let tax = 0;
  for (const { qty, unit, rate } of lines) {
    net -= qty * unit;
    tax -= Math.round(qty * unit * rate * 100) / 100;
  }
  return { net: Math.round(net * 100) / 100, tax: Math.round(tax * 100) / 100, gross: Math.round((net + tax) * 100) / 100 };
}
