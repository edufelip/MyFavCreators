declare const moneyCentsBrand: unique symbol;

/**
 * A non-negative integer amount of BRL centavos.
 *
 * Money is never represented as a float anywhere in Creator Outdoor. The brand
 * makes an unchecked `number` unassignable, so every value has passed through
 * {@link moneyCents} and is guaranteed to be a safe non-negative integer.
 */
export type MoneyCents = number & { readonly [moneyCentsBrand]: "MoneyCents" };

export const CURRENCY = "BRL" as const;
export type Currency = typeof CURRENCY;

export class InvalidMoneyError extends Error {
  override readonly name = "InvalidMoneyError";

  constructor(value: unknown) {
    super(
      `Monetary values must be non-negative safe integers of centavos, received: ${String(value)}`,
    );
  }
}

export function isMoneyCents(value: unknown): value is MoneyCents {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validates and brands a raw number as centavos. Throws on floats and negatives. */
export function moneyCents(value: number): MoneyCents {
  if (!isMoneyCents(value)) {
    throw new InvalidMoneyError(value);
  }
  return value;
}

export const ZERO_CENTS: MoneyCents = moneyCents(0);

/**
 * Widens branded centavos to a plain number.
 *
 * Needed wherever a value must be compared against, or handed to, an ordinary
 * `number` — a presentation formatter, a DTO field, a test assertion — without
 * reaching for a type assertion.
 */
export function centsValue(value: MoneyCents): number {
  return value;
}

export function addCents(a: MoneyCents, b: MoneyCents): MoneyCents {
  return moneyCents(a + b);
}

/** Difference, floored at zero. Creator Outdoor never represents negative money. */
export function subtractCents(a: MoneyCents, b: MoneyCents): MoneyCents {
  return moneyCents(Math.max(0, a - b));
}

export function sumCents(values: Iterable<MoneyCents>): MoneyCents {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return moneyCents(total);
}

export function maxCents(a: MoneyCents, b: MoneyCents): MoneyCents {
  return a >= b ? a : b;
}

/**
 * Parses a value that crossed an untyped boundary (database driver, JSON body,
 * SQL aggregate returned as a string) into branded centavos.
 */
export function parseMoneyCents(value: unknown): MoneyCents {
  if (typeof value === "number") {
    return moneyCents(value);
  }
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new InvalidMoneyError(value);
    }
    return moneyCents(Number(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return moneyCents(Number.parseInt(value, 10));
  }
  throw new InvalidMoneyError(value);
}
