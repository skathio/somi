const TABLE = { USD: { digits: 2, symbol: '$' }, EUR: { digits: 2, symbol: '€' }, JPY: { digits: 0, symbol: '¥' }, KWD: { digits: 3, symbol: 'KD ' } };
export const known = (code) => Object.hasOwn(TABLE, code);
export const minorDigits = (code) => TABLE[code].digits;
export const symbol = (code) => TABLE[code].symbol;
