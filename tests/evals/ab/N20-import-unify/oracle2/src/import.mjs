// SOMI-CANARY-N20-7a7f1e4433d0a5f1
import { importRows } from './rows.mjs';

export const importOrders = (rows) => importRows(rows, { fold: true, firstWins: true, skipBlank: true, round: Math.round });
export const importRefunds = (rows) => importRows(rows, { round: Math.trunc });
export const importCredits = (rows) => importRows(rows, { round: Math.trunc, positive: true });
