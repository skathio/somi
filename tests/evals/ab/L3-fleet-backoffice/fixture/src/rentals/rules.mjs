// Short-term rentals. A week or longer earns a discount.
// All amounts here are dollars.
const BULK_FROM = 7;
const BULK_PERCENT = 15;

export function priceRentals(units, rate) {
  const gross = units * rate;
  return units >= BULK_FROM ? Math.round((gross * (100 - BULK_PERCENT) / 100) * 100) / 100 : Math.round((gross) * 100) / 100;
}

export function rentalsExplained(units, rate) {
  const amount = priceRentals(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const rentalsLabel = (units) => `${units} days`;
