import type { MoneyCents } from "../src/money";

/**
 * Widens branded centavos to a plain number.
 *
 * `expect(received).toBe(expected)` infers the expected type from the received
 * one, so a branded value rejects a numeric literal. Reading these assertions
 * against plain integers is also the point of most of them: money is an integer
 * number of centavos and nothing else.
 */
export function cents(value: MoneyCents): number {
  return value;
}
