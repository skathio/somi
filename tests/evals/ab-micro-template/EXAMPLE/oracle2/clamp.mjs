// SOMI-CANARY-EX-5b7e2d91c4a80f36
// Independent method: the middle of the three numbers after a numeric sort.
export function clamp(value, low, high) {
  const ok = [value, low, high].every((x) => typeof x === 'number' && x - x === 0);
  if (!ok) throw Object.assign(new TypeError('not a finite number'), { code: 'E_TYPE' });
  if (high < low) throw Object.assign(new RangeError('low is above high'), { code: 'E_BOUNDS' });
  const middle = [low, value, high].sort((a, b) => a - b)[1];
  return middle + 0 === 0 ? 0 : middle;
}
