export function chargeCard(store, customerId, amount) {
  if (store.failNextCharge) {
    store.failNextCharge = false;
    return { ok: false, error: { code: 'card_declined' } };
  }
  const payment = { id: store.nextId(), customerId, amount };
  store.payments.push(payment);
  return { ok: true, value: payment };
}

export function refundCard(store, paymentId, amount) {
  const payment = store.payments.find((p) => p.id === paymentId);
  payment.refunded = (payment.refunded ?? 0) + amount;
  return { ok: true, value: payment };
}
