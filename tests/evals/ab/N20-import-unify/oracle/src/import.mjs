// SOMI-CANARY-N20-7a7f1e4433d0a5f1
import { importRows } from './rows.mjs';

const ORDERS = {
  email: (e) => e.trim().toLowerCase(),
  parse: (text) => Math.round(Number(text.replaceAll(',', '')) * 100),
  blank: 'skip',
  keep: 'first',
};
const REFUNDS = {
  email: (e) => e.trim(),
  parse: (text) => Math.trunc(Number(text.replaceAll(',', '')) * 100),
  blank: 'zero',
  keep: 'latest',
};

export const importOrders = (rows) => importRows(rows, ORDERS);
export const importRefunds = (rows) => importRows(rows, REFUNDS);
export const importCredits = (rows) => importRows(rows, { ...REFUNDS, accept: (amount) => amount > 0 });
