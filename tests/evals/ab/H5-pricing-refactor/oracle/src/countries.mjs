// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Per-country rules shared by shipping and tax: is the shelf price tax-inclusive, tax rate per category, is shipping
// taxed, free-shipping threshold, [base, per kg] for standard and express, and the small-order limit with its fee.

export const COUNTRY = {
  US: { inc: false, tax: { general: 0.0725, book: 0.0725, digital: 0.0725, food: 0 }, shipTax: false, free: 75, std: [4.99, 1.2], exp: [14.99, 2.5], small: 15, fee: 1.5 },
  CA: { inc: false, tax: { general: 0.05, book: 0.05, digital: 0.05, food: 0 }, shipTax: true, free: 100, std: [9.5, 1.9], exp: [22, 3.1], small: 20, fee: 2 },
  DE: { inc: true, tax: { general: 0.19, book: 0.07, digital: 0.19, food: 0.07 }, shipTax: true, free: 60, std: [5.9, 0.9], exp: [16.9, 2.2], small: 10, fee: 1.2 },
  FR: { inc: true, tax: { general: 0.2, book: 0.055, digital: 0.2, food: 0.055 }, shipTax: true, free: 60, std: [6.4, 1.1], exp: [17.5, 2.4], small: 10, fee: 1.2 },
  GB: { inc: true, tax: { general: 0.2, book: 0, digital: 0.2, food: 0 }, shipTax: true, free: 50, std: [3.95, 0.8], exp: [12.95, 1.85], small: 10, fee: 1 },
  JP: { inc: true, tax: { general: 0.1, book: 0.1, digital: 0.1, food: 0.08 }, shipTax: true, free: 8000, std: [550, 90], exp: [1200, 240], small: 1500, fee: 150 },
};
