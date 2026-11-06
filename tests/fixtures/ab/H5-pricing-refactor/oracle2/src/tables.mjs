// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Rate cards and coupon definitions.

const card = (inc, tax, shipTax, free, std, exp, small, fee) => ({ inc, tax, shipTax, free, std, exp, small, fee });

export const COUNTRIES = {
  US: card(false, { general: 0.0725, book: 0.0725, digital: 0.0725, food: 0 }, false, 75, [4.99, 1.2], [14.99, 2.5], 15, 1.5),
  CA: card(false, { general: 0.05, book: 0.05, digital: 0.05, food: 0 }, true, 100, [9.5, 1.9], [22, 3.1], 20, 2),
  DE: card(true, { general: 0.19, book: 0.07, digital: 0.19, food: 0.07 }, true, 60, [5.9, 0.9], [16.9, 2.2], 10, 1.2),
  FR: card(true, { general: 0.2, book: 0.055, digital: 0.2, food: 0.055 }, true, 60, [6.4, 1.1], [17.5, 2.4], 10, 1.2),
  GB: card(true, { general: 0.2, book: 0, digital: 0.2, food: 0 }, true, 50, [3.95, 0.8], [12.95, 1.85], 10, 1),
  JP: card(true, { general: 0.1, book: 0.1, digital: 0.1, food: 0.08 }, true, 8000, [550, 90], [1200, 240], 1500, 150),
};

export const TIERS = { standard: 0, silver: 2, gold: 5 };
export const BULK = [[25, 6], [10, 3]];

export const COUPONS = {
  SAVE10: { kind: 'percent', value: 10, min: 0 },
  SAVE20: { kind: 'percent', value: 20, min: 100 },
  BOOKS15: { kind: 'percent', value: 15, min: 0, only: 'book' },
  GOLD5: { kind: 'percent', value: 5, min: 0, tier: 'gold' },
  FIVEOFF: { kind: 'fixed', value: 5, min: 30, after: true },
  TENOFF: { kind: 'fixed', value: 10, min: 50 },
  WELCOME: { kind: 'fixed', value: 8, min: 20, until: '2025-06-30' },
  FREESHIP: { kind: 'ship', min: 25 },
};
export const COUPON_ORDER = ['SAVE20', 'SAVE10', 'GOLD5', 'BOOKS15', 'TENOFF', 'FIVEOFF', 'WELCOME', 'FREESHIP'];
