export interface IdGenerator {
  next(prefix: string): string;
}

// Ids feed PayPal-Request-Id, so they must stay unique across restarts.
export class CryptoIds implements IdGenerator {
  next(prefix: string) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
}
