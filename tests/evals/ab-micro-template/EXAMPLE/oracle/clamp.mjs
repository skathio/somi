// SOMI-CANARY-EX-5b7e2d91c4a80f36
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const fail = (Kind, code) => Object.assign(new Kind('invalid argument'), { code });

export function clamp(value, low, high) {
  for (const x of [value, low, high]) if (!finite(x)) throw fail(TypeError, 'E_TYPE');
  if (low > high) throw fail(RangeError, 'E_BOUNDS');
  const result = value < low ? low : value > high ? high : value;
  return result === 0 ? 0 : result;
}
