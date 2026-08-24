import { describe, expect, test } from "bun:test";
import {
  allowedModerationTransitions,
  assertModerationTransition,
  canTransitionModeration,
  formatOwnershipCode,
  InvalidModerationTransitionError,
  isPubliclyEligible,
  isWellFormedOwnershipCode,
  MODERATION_STATUSES,
  type ModerationStatus,
  OWNERSHIP_CODE_ALPHABET,
  requiresSuppression,
  textContainsOwnershipCode,
} from "../src/creator";

describe("moderation transitions", () => {
  test("a submission can be approved, rejected or removed", () => {
    expect([...allowedModerationTransitions("PENDING_REVIEW")].sort()).toEqual([
      "APPROVED",
      "REJECTED",
      "REMOVED",
    ]);
  });

  test("a verified opt-out is terminal", () => {
    expect(allowedModerationTransitions("OPTED_OUT")).toEqual([]);
    for (const target of MODERATION_STATUSES) {
      expect(canTransitionModeration("OPTED_OUT", target), target).toBe(false);
    }
  });

  test("no status may transition to itself", () => {
    for (const status of MODERATION_STATUSES) {
      expect(canTransitionModeration(status, status), status).toBe(false);
    }
  });

  test("a pending opt-out can complete, be abandoned, or be removed for safety", () => {
    expect([...allowedModerationTransitions("OPTOUT_VERIFICATION_PENDING")].sort()).toEqual([
      "APPROVED",
      "OPTED_OUT",
      "REMOVED",
    ]);
  });

  test("an unverified opt-out request cannot hide a creator on its own", () => {
    // Requesting removal only moves the creator to OPTOUT_VERIFICATION_PENDING,
    // which is still not a public status change: the creator stays visible.
    expect(canTransitionModeration("APPROVED", "OPTOUT_VERIFICATION_PENDING")).toBe(true);
    expect(isPubliclyEligible("OPTOUT_VERIFICATION_PENDING")).toBe(false);
  });

  test("a rejected or removed creator can be restored by an administrator", () => {
    expect(canTransitionModeration("REJECTED", "APPROVED")).toBe(true);
    expect(canTransitionModeration("REMOVED", "APPROVED")).toBe(true);
  });

  test("a creator cannot jump straight from pending review to opted out", () => {
    expect(canTransitionModeration("PENDING_REVIEW", "OPTED_OUT")).toBe(false);
    expect(canTransitionModeration("PENDING_REVIEW", "OPTOUT_VERIFICATION_PENDING")).toBe(false);
  });

  test("asserting an illegal transition throws with both statuses named", () => {
    expect(() => assertModerationTransition("OPTED_OUT", "APPROVED")).toThrow(
      InvalidModerationTransitionError,
    );
    expect(() => assertModerationTransition("OPTED_OUT", "APPROVED")).toThrow(
      /OPTED_OUT.*APPROVED/,
    );
    expect(() => assertModerationTransition("PENDING_REVIEW", "APPROVED")).not.toThrow();
  });

  test("only a verified opt-out suppresses the profile against resubmission", () => {
    const suppressing = MODERATION_STATUSES.filter(requiresSuppression);
    expect(suppressing).toEqual(["OPTED_OUT"]);
  });

  test("every reachable status is reachable from a submission", () => {
    const reachable = new Set<ModerationStatus>(["PENDING_REVIEW"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const status of [...reachable]) {
        for (const next of allowedModerationTransitions(status)) {
          if (!reachable.has(next)) {
            reachable.add(next);
            changed = true;
          }
        }
      }
    }
    expect([...reachable].sort()).toEqual([...MODERATION_STATUSES].sort());
  });
});

describe("ownership code", () => {
  const CODE = formatOwnershipCode("ABCD2345");

  test("is prefixed and uppercase", () => {
    expect(CODE).toBe("CO-ABCD2345");
    expect(formatOwnershipCode("abcd2345")).toBe("CO-ABCD2345");
  });

  test("accepts only well-formed codes", () => {
    expect(isWellFormedOwnershipCode("CO-ABCD2345")).toBe(true);
    expect(isWellFormedOwnershipCode("  co-abcd2345 ")).toBe(true);
    expect(isWellFormedOwnershipCode("CO-ABCD234")).toBe(false);
    expect(isWellFormedOwnershipCode("ABCD2345")).toBe(false);
    expect(isWellFormedOwnershipCode("CO-ABCD2340")).toBe(false); // 0 is not in the alphabet
    expect(isWellFormedOwnershipCode("CO-ABCD234I")).toBe(false); // nor is I
    expect(isWellFormedOwnershipCode("")).toBe(false);
  });

  test("excludes characters people mistype", () => {
    for (const ambiguous of ["0", "O", "1", "I", "L"]) {
      expect(OWNERSHIP_CODE_ALPHABET.includes(ambiguous), ambiguous).toBe(false);
    }
  });

  test("finds the code however a person pasted it into a bio", () => {
    for (const bio of [
      "CO-ABCD2345",
      "musicista · co-abcd2345 · são paulo",
      "🎵 verificação: CO-ABCD2345 🎵",
      "linha um\nCO-ABCD2345\nlinha três",
      "CO ABCD2345",
      "CO–ABCD2345",
    ]) {
      expect(textContainsOwnershipCode(bio, CODE), bio).toBe(true);
    }
  });

  test("does not accept a near miss", () => {
    for (const bio of ["CO-ABCD2346", "CO-ABCD234", "ABCD2345", "", "nenhum código aqui"]) {
      expect(textContainsOwnershipCode(bio, CODE), bio).toBe(false);
    }
  });

  test("never matches when the expected code is itself malformed", () => {
    expect(textContainsOwnershipCode("qualquer coisa", "not-a-code")).toBe(false);
    expect(textContainsOwnershipCode("", "")).toBe(false);
  });
});
