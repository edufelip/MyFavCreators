import { describe, expect, test } from "bun:test";
import {
  BOOST_STATUSES,
  CLAIM_STATUSES,
  CREATOR_PLATFORMS,
  DELIVERY_SURFACES,
  MODERATION_STATUSES,
  PAYMENT_STATUSES,
  RANKING_PERIOD_STATUSES,
  RANKING_PERIOD_TYPES,
  REJECTION_REASONS,
} from "@creator-outdoor/domain";
import type { TSchema } from "@sinclair/typebox";
import {
  API_ERROR_CODES,
  ApiErrorCodeSchema,
  CREATOR_SUBMISSION_OUTCOMES,
  CreatorSubmissionOutcomeSchema,
  DeliverySurfaceSchema,
  OPT_OUT_VERIFICATION_OUTCOMES,
  OptOutVerificationOutcomeSchema,
  REPORT_REASONS,
  ReportReasonSchema,
} from "../src";
import { BOOST_ORIGINS, BoostOriginSchema } from "../src/boosts";
import { CLAIM_VERIFICATION_OUTCOMES, ClaimVerificationOutcomeSchema } from "../src/claims";
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
  ["api error code", ApiErrorCodeSchema, API_ERROR_CODES],
  ["creator submission outcome", CreatorSubmissionOutcomeSchema, CREATOR_SUBMISSION_OUTCOMES],
  ["report reason", ReportReasonSchema, REPORT_REASONS],
  ["opt-out verification outcome", OptOutVerificationOutcomeSchema, OPT_OUT_VERIFICATION_OUTCOMES],
  ["delivery surface", DeliverySurfaceSchema, DELIVERY_SURFACES],
  /*
   * These two live beside their own list in the same file, and were the two the
   * parity check did not cover. A third boost origin added to the list and not
   * to the schema compiles, passes every other test, and 500s on a checkout
   * response — `getCheckout` degrades anything unrecognised to DIRECT, so a
   * reloaded checkout would quietly drop the rank quote disclosure.
   */
  ["boost origin", BoostOriginSchema, BOOST_ORIGINS],
  ["claim verification outcome", ClaimVerificationOutcomeSchema, CLAIM_VERIFICATION_OUTCOMES],
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
