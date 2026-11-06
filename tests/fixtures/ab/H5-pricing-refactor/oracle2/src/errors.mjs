// SOMI-CANARY-H5-6c2e9a41d7b3f085
export class PricingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}

export const refuse = (code, message) => new PricingError(code, message);
