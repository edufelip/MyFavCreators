import { describe, expect, test } from "bun:test";
import {
  allowedBoostTransitions,
  assertBoostTransition,
  BOOST_STATUSES,
  boostStatusForPayment,
  canTransitionBoost,
  InvalidBoostTransitionError,
} from "../src/boost";
import {
  allowedPaymentTransitions,
  assertPaymentTransition,
  canTransitionPayment,
  InvalidPaymentTransitionError,
  isSettledPaymentStatus,
  isTerminalPaymentStatus,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from "../src/payment";

describe("payment transitions", () => {
  test("a new payment starts as CREATED and can only move forward", () => {
    expect([...allowedPaymentTransitions("CREATED")].sort()).toEqual([
      "CANCELLED",
      "CONFIRMED",
      "EXPIRED",
      "FAILED",
      "PENDING",
    ]);
  });

  test("a confirmed payment can only be refunded", () => {
    expect(allowedPaymentTransitions("CONFIRMED")).toEqual(["REFUNDED"]);
  });

  test("a refund is final", () => {
    expect(allowedPaymentTransitions("REFUNDED")).toEqual([]);
    for (const target of PAYMENT_STATUSES) {
      expect(canTransitionPayment("REFUNDED", target), target).toBe(false);
    }
  });

  test("a failed, expired or cancelled payment never becomes confirmed", () => {
    for (const dead of ["FAILED", "EXPIRED", "CANCELLED"] as const) {
      expect(canTransitionPayment(dead, "CONFIRMED"), dead).toBe(false);
      expect(allowedPaymentTransitions(dead), dead).toEqual([]);
    }
  });

  test("no status transitions to itself, so a repeated event is never a move", () => {
    for (const status of PAYMENT_STATUSES) {
      expect(canTransitionPayment(status, status), status).toBe(false);
    }
  });

  test("only CONFIRMED and REFUNDED are settled outcomes", () => {
    expect(PAYMENT_STATUSES.filter(isSettledPaymentStatus)).toEqual(["CONFIRMED", "REFUNDED"]);
  });

  test("terminal statuses accept no further transition", () => {
    const terminal = PAYMENT_STATUSES.filter(isTerminalPaymentStatus);
    expect(terminal.sort()).toEqual(["CANCELLED", "EXPIRED", "FAILED", "REFUNDED"]);
    for (const status of terminal) {
      expect(allowedPaymentTransitions(status), status).toEqual([]);
    }
  });

  test("asserting an illegal transition names both statuses", () => {
    expect(() => assertPaymentTransition("CONFIRMED", "PENDING")).toThrow(
      InvalidPaymentTransitionError,
    );
    expect(() => assertPaymentTransition("CONFIRMED", "PENDING")).toThrow(/CONFIRMED.*PENDING/);
    expect(() => assertPaymentTransition("PENDING", "CONFIRMED")).not.toThrow();
  });

  test("every status is reachable from CREATED", () => {
    const reachable = new Set<PaymentStatus>(["CREATED"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const status of [...reachable]) {
        for (const next of allowedPaymentTransitions(status)) {
          if (!reachable.has(next)) {
            reachable.add(next);
            changed = true;
          }
        }
      }
    }
    expect([...reachable].sort()).toEqual([...PAYMENT_STATUSES].sort());
  });
});

describe("boost transitions", () => {
  test("a boost starts PENDING and settles once", () => {
    expect([...allowedBoostTransitions("PENDING")].sort()).toEqual(["ACTIVE", "VOID"]);
    expect(allowedBoostTransitions("ACTIVE")).toEqual(["REVERSED"]);
    expect(allowedBoostTransitions("VOID")).toEqual([]);
    expect(allowedBoostTransitions("REVERSED")).toEqual([]);
  });

  test("a reversed boost never becomes active again", () => {
    for (const target of BOOST_STATUSES) {
      expect(canTransitionBoost("REVERSED", target), target).toBe(false);
    }
  });

  test("a void boost never activates: the money never settled", () => {
    expect(canTransitionBoost("VOID", "ACTIVE")).toBe(false);
  });

  test("asserting an illegal transition throws", () => {
    expect(() => assertBoostTransition("VOID", "ACTIVE")).toThrow(InvalidBoostTransitionError);
    expect(() => assertBoostTransition("PENDING", "ACTIVE")).not.toThrow();
  });
});

describe("boost status follows payment status", () => {
  test("a confirmed payment activates the boost", () => {
    expect(boostStatusForPayment("CONFIRMED")).toBe("ACTIVE");
  });

  test("money that never settled voids the promotion", () => {
    for (const status of ["FAILED", "EXPIRED", "CANCELLED"] as const) {
      expect(boostStatusForPayment(status), status).toBe("VOID");
    }
  });

  test("a refund reverses a promotion that was already delivered", () => {
    expect(boostStatusForPayment("REFUNDED")).toBe("REVERSED");
  });

  test("an unsettled payment leaves the boost pending", () => {
    expect(boostStatusForPayment("CREATED")).toBe("PENDING");
    expect(boostStatusForPayment("PENDING")).toBe("PENDING");
  });

  test("every payment status maps to exactly one boost status", () => {
    for (const status of PAYMENT_STATUSES) {
      expect(BOOST_STATUSES).toContain(boostStatusForPayment(status));
    }
  });
});
