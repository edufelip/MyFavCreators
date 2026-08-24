import { describe, expect, test } from "bun:test";
import {
  BOOST_STATUSES,
  CLAIM_STATUSES,
  CREATOR_PLATFORMS,
  MODERATION_STATUSES,
  PAYMENT_STATUSES,
  RANKING_PERIOD_STATUSES,
  RANKING_PERIOD_TYPES,
  REJECTION_REASONS,
} from "@creator-outdoor/domain";
import type { TSchema } from "@sinclair/typebox";
import {
  BoostStatusSchema,
  ClaimStatusSchema,
  CreatorPlatformSchema,
  ModerationStatusSchema,
  PaymentStatusSchema,
  RankingPeriodStatusSchema,
  RankingPeriodTypeSchema,
  RejectionReasonSchema,
} from "../src/enums";
import { matchesContract } from "../src/validate";

function literalValues(schema: { readonly anyOf: readonly TSchema[] }): string[] {
  return schema.anyOf.map((member) => {
    const value = "const" in member ? member["const"] : undefined;
    if (typeof value !== "string") {
      throw new Error("Enum schema member is not a string literal");
    }
    return value;
  });
}

const PAIRS = [
  ["boost status", BoostStatusSchema, BOOST_STATUSES],
  ["payment status", PaymentStatusSchema, PAYMENT_STATUSES],
  ["moderation status", ModerationStatusSchema, MODERATION_STATUSES],
  ["rejection reason", RejectionReasonSchema, REJECTION_REASONS],
  ["claim status", ClaimStatusSchema, CLAIM_STATUSES],
  ["creator platform", CreatorPlatformSchema, CREATOR_PLATFORMS],
  ["ranking period type", RankingPeriodTypeSchema, RANKING_PERIOD_TYPES],
  ["ranking period status", RankingPeriodStatusSchema, RANKING_PERIOD_STATUSES],
] as const;

describe("contract enums mirror the domain", () => {
  for (const [label, schema, domainValues] of PAIRS) {
    test(`${label} exposes exactly the domain values, in order`, () => {
      expect(literalValues(schema)).toEqual([...domainValues]);
    });

    test(`${label} rejects a value the domain does not define`, () => {
      expect(matchesContract(schema, "NOT_A_REAL_VALUE")).toBe(false);
      for (const value of domainValues) {
        expect(matchesContract(schema, value)).toBe(true);
      }
    });
  }
});
