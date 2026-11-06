export function createStore(now = 0) {
  let id = 1;
  let time = now;
  return {
    products: new Map(), stock: new Map(), carts: new Map(), orders: [], payments: [], refunds: [], coupons: new Map(), reservations: [], audit: [],
    nextId: () => `id${id++}`,
    clock: () => time,
    advance: (ms) => { time += ms; },
    failNextCharge: false,
  };
}
