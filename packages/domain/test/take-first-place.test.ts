import { describe, expect, test } from "bun:test";
import { moneyCents } from "../src/money";
import {
  calculateOvertakeQuote,
  calculateTakeFirstPlace,
  takeFirstPlaceQuote,
} from "../src/ranking";
import { cents } from "./support";

const MIN_INCREMENT = moneyCents(100);
const MIN_BOOST = moneyCents(500);

function quote(leader: number, creator: number): number {
  return calculateTakeFirstPlace({
    leaderAmountCents: moneyCents(leader),
    creatorAmountCents: moneyCents(creator),
    minIncrementCents: MIN_INCREMENT,
    minBoostCents: MIN_BOOST,
  });
}

describe("calculateTakeFirstPlace", () => {
  test("matches the documented example: R$487 leader, R$393 creator, R$95 required", () => {
    expect(quote(48700, 39300)).toBe(9500);
  });

  test("is the gap plus the minimum increment", () => {
    expect(quote(100000, 50000)).toBe(50100);
    expect(quote(2000, 1000)).toBe(1100);
  });

  test("never quotes below the minimum boost", () => {
    // Level with the leader: the raw requirement is R$1, floored to R$5.
    expect(quote(10000, 10000)).toBe(500);
    // R$0,50 behind: raw requirement R$1,50, still floored to R$5.
    expect(quote(10050, 10000)).toBe(500);
  });

  test("quotes exactly the minimum boost for a creator with nothing yet and no leader", () => {
    expect(quote(0, 0)).toBe(500);
  });

  test("crosses the minimum boost cleanly", () => {
    expect(quote(10400, 10000)).toBe(500);
    expect(quote(10500, 10000)).toBe(600);
  });

  test("stays in integer centavos", () => {
    const result = quote(48733, 39311);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(9522);
  });
});

describe("takeFirstPlaceQuote", () => {
  test("is hidden for the current leader", () => {
    expect(
      takeFirstPlaceQuote({
        leaderAmountCents: moneyCents(48700),
        creatorAmountCents: moneyCents(48700),
        minIncrementCents: MIN_INCREMENT,
        minBoostCents: MIN_BOOST,
        isCurrentLeader: true,
      }),
    ).toBeNull();
  });

  test("is shown for everybody who is not #1", () => {
    const quoted = takeFirstPlaceQuote({
      leaderAmountCents: moneyCents(48700),
      creatorAmountCents: moneyCents(39300),
      minIncrementCents: MIN_INCREMENT,
      minBoostCents: MIN_BOOST,
      isCurrentLeader: false,
    });
    expect(quoted === null ? null : cents(quoted)).toBe(9500);
  });

  test("the quote reserves nothing: the same amount applies after the ranking moves", () => {
    const seenByCustomer = quote(48700, 39300);
    // While the PIX was pending, another fandom pushed the leader to R$900.
    const leaderNow = moneyCents(90000);
    const creatorAfterPaying = moneyCents(39300 + seenByCustomer);
    expect(seenByCustomer).toBe(9500);
    // The customer is charged exactly what they saw; the resulting position is
    // simply whatever the ranking says, and #1 is not guaranteed.
    expect(cents(creatorAfterPaying)).toBe(48800);
    expect(creatorAfterPaying < leaderNow).toBe(true);
  });
});

describe("calculateOvertakeQuote", () => {
  test("calculates quote to overtake a mid-ranking competitor or reach Top 3", () => {
    // Creator has R$ 50, Target has R$ 80 -> needs R$ 31 (gap R$ 30 + R$ 1 increment)
    const needed = calculateOvertakeQuote({
      targetCreatorAmountCents: moneyCents(8000),
      creatorAmountCents: moneyCents(5000),
      minIncrementCents: MIN_INCREMENT,
      minBoostCents: MIN_BOOST,
    });
    expect(cents(needed)).toBe(3100);
  });

  test("floors small gap to minimum boost", () => {
    // Gap is R$ 2 -> raw is R$ 3, floored to R$ 5
    const needed = calculateOvertakeQuote({
      targetCreatorAmountCents: moneyCents(5200),
      creatorAmountCents: moneyCents(5000),
      minIncrementCents: MIN_INCREMENT,
      minBoostCents: MIN_BOOST,
    });
    expect(cents(needed)).toBe(500);
  });
});
