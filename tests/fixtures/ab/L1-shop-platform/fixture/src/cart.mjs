import { getProduct } from './catalog.mjs';

export function addToCart(store, cartId, sku, qty) {
  const cart = store.carts.get(cartId) ?? { id: cartId, lines: [] };
  const line = cart.lines.find((l) => l.sku === sku);
  if (line) line.qty += qty;
  else cart.lines.push({ sku, qty });
  store.carts.set(cartId, cart);
  return cart;
}

export function cartTotal(store, cart) {
  return cart.lines.reduce((sum, l) => sum + getProduct(store, l.sku).price * l.qty, 0);
}
