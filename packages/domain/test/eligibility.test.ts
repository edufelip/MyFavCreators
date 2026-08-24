import { describe, expect, test } from "bun:test";
import { BOOST_STATUSES, type BoostStatus, contributesToRanking } from "../src/boost";
import { isPubliclyEligible, MODERATION_STATUSES } from "../src/creator";
import { PAYMENT_STATUSES, type PaymentStatus } from "../src/payment";
import { calculateRotationWindow, isRotationActive } from "../src/rotation";
import { ANONYMOUS_SUPPORTER_DISPLAY_NAME, resolveSupporterDisplayName } from "../src/supporter";

describe("ranking contribution", () => {
  test("an ACTIVE boost with a CONFIRMED payment is the only combination that counts", () => {
    const counted: Array<[BoostStatus, PaymentStatus]> = [];
    for (const boostStatus of BOOST_STATUSES) {
      for (const paymentStatus of PAYMENT_STATUSES) {
        if (contributesToRanking({ boostStatus, paymentStatus })) {
          counted.push([boostStatus, paymentStatus]);
        }
      }
    }
    expect(counted).toEqual([["ACTIVE", "CONFIRMED"]]);
  });

  test("unsettled and reversed payments never rank", () => {
    for (const paymentStatus of [
      "CREATED",
      "PENDING",
      "FAILED",
      "EXPIRED",
      "CANCELLED",
      "REFUNDED",
    ] as const) {
      expect(contributesToRanking({ boostStatus: "ACTIVE", paymentStatus })).toBe(false);
    }
  });

  test("a confirmed payment behind a non-active boost never ranks", () => {
    for (const boostStatus of ["PENDING", "VOID", "REVERSED"] as const) {
      expect(contributesToRanking({ boostStatus, paymentStatus: "CONFIRMED" })).toBe(false);
    }
  });
});

describe("public creator eligibility", () => {
  test("only APPROVED creators may appear publicly", () => {
    const eligible = MODERATION_STATUSES.filter(isPubliclyEligible);
    expect(eligible).toEqual(["APPROVED"]);
  });
});

describe("rotation window", () => {
  test("starts at confirmation and lasts the configured hours", () => {
    const confirmedAt = new Date("2026-08-19T18:30:00.000Z");
    const window = calculateRotationWindow(confirmedAt, 24);
    expect(window.rotationStartsAt.toISOString()).toBe("2026-08-19T18:30:00.000Z");
    expect(window.rotationEndsAt.toISOString()).toBe("2026-08-20T18:30:00.000Z");
  });

  test("expires exactly at the end of the window", () => {
    const window = calculateRotationWindow(new Date("2026-08-19T18:30:00.000Z"), 24);
    expect(isRotationActive(window.rotationStartsAt, window)).toBe(true);
    expect(isRotationActive(new Date("2026-08-20T18:29:59.999Z"), window)).toBe(true);
    expect(isRotationActive(window.rotationEndsAt, window)).toBe(false);
  });

  test("rejects a non-positive rotation length", () => {
    expect(() => calculateRotationWindow(new Date(), 0)).toThrow(RangeError);
    expect(() => calculateRotationWindow(new Date(), Number.NaN)).toThrow(RangeError);
  });
});

describe("supporter display name", () => {
  test("anonymous boosts display Anônimo", () => {
    expect(resolveSupporterDisplayName({ anonymous: true, supporterName: "Marina" })).toBe(
      ANONYMOUS_SUPPORTER_DISPLAY_NAME,
    );
    expect(resolveSupporterDisplayName({ anonymous: false, supporterName: null })).toBe(
      ANONYMOUS_SUPPORTER_DISPLAY_NAME,
    );
    expect(resolveSupporterDisplayName({ anonymous: false, supporterName: "   " })).toBe(
      ANONYMOUS_SUPPORTER_DISPLAY_NAME,
    );
  });

  test("keeps a provided display name", () => {
    expect(resolveSupporterDisplayName({ anonymous: false, supporterName: " Marina " })).toBe(
      "Marina",
    );
  });
});
