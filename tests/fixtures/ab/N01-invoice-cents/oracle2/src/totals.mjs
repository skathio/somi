// SOMI-CANARY-N01-df51963559cd8805
// Integer arithmetic throughout: a rate becomes parts per million so a tie is seen as a tie.
export function totals(lines) {
  const byRate = {};
  let net = 0;
  for (const l of lines) {
    const cents = l.qty * Math.round(l.unit * 100);
    net += cents;
    const ppm = Math.round(l.rate * 1e6);
    byRate[ppm] = (byRate[ppm] ?? 0) + cents;
  }
  let tax = 0;
  for (const [ppm, sum] of Object.entries(byRate)) {
    const whole = sum * Number(ppm);
    const floor = Math.floor(whole / 1e6);
    const rest = whole - floor * 1e6;
    tax += rest * 2 < 1e6 ? floor : rest * 2 > 1e6 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1;
  }
  return { net, tax };
}
