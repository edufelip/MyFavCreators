import { describe, expect, test } from "bun:test";
import {
  addCents,
  InvalidMoneyError,
  isMoneyCents,
  maxCents,
  moneyCents,
  parseMoneyCents,
  subtractCents,
  sumCents,
  ZERO_CENTS,
} from "../src/money";
import { cents } from "./support";

describe("money", () => {
  test("accepts non-negative integer centavos", () => {
    expect(cents(moneyCents(0))).toBe(ZERO_CENTS);
    expect(cents(moneyCents(500))).toBe(500);
    expect(cents(moneyCents(9990))).toBe(9990);
  });

  test("rejects floats so BRL never becomes a float", () => {
    expect(() => moneyCents(99.9)).toThrow(InvalidMoneyError);
    expect(() => moneyCents(0.1 + 0.2)).toThrow(InvalidMoneyError);
    expect(() => moneyCents(5.0000001)).toThrow(InvalidMoneyError);
  });

  test("rejects negative, NaN and unsafe values", () => {
    expect(() => moneyCents(-1)).toThrow(InvalidMoneyError);
    expect(() => moneyCents(Number.NaN)).toThrow(InvalidMoneyError);
    expect(() => moneyCents(Number.POSITIVE_INFINITY)).toThrow(InvalidMoneyError);
    expect(() => moneyCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(InvalidMoneyError);
  });

  test("maps the documented BRL examples", () => {
    expect(cents(moneyCents(500))).toBe(500); // R$5,00
    expect(cents(moneyCents(1000))).toBe(1000); // R$10,00
    expect(cents(moneyCents(9990))).toBe(9990); // R$99,90
  });

  test("arithmetic stays in integer centavos", () => {
    expect(cents(addCents(moneyCents(500), moneyCents(9990)))).toBe(10490);
    expect(cents(subtractCents(moneyCents(48700), moneyCents(39300)))).toBe(9400);
    expect(cents(sumCents([moneyCents(500), moneyCents(1000), moneyCents(2500)]))).toBe(4000);
    expect(cents(maxCents(moneyCents(100), moneyCents(500)))).toBe(500);
  });

  test("subtraction floors at zero rather than producing negative money", () => {
    expect(cents(subtractCents(moneyCents(100), moneyCents(500)))).toBe(0);
  });

  test("sum of an empty set is zero", () => {
    expect(cents(sumCents([]))).toBe(ZERO_CENTS);
  });

  test("parses values crossing untyped boundaries", () => {
    expect(cents(parseMoneyCents(500))).toBe(500);
    expect(cents(parseMoneyCents("48700"))).toBe(48700);
    expect(cents(parseMoneyCents(1234n))).toBe(1234);
    expect(() => parseMoneyCents("48.7")).toThrow(InvalidMoneyError);
    expect(() => parseMoneyCents(null)).toThrow(InvalidMoneyError);
    expect(() => parseMoneyCents(undefined)).toThrow(InvalidMoneyError);
  });

  test("isMoneyCents narrows unknown input", () => {
    expect(isMoneyCents(0)).toBe(true);
    expect(isMoneyCents(-1)).toBe(false);
    expect(isMoneyCents("500")).toBe(false);
    expect(isMoneyCents(1.5)).toBe(false);
  });
});
