import { type Static, Type as t } from "@sinclair/typebox";

/**
 * DTO enums are written out as explicit literal unions so `Static<>` infers the
 * exact union rather than widening to `string`. `test/enums.test.ts` proves each
 * one stays identical to the domain enum it mirrors, so adding a value to the
 * domain without adding it here fails the build.
 */

export const BoostStatusSchema = t.Union([
  t.Literal("PENDING"),
  t.Literal("ACTIVE"),
  t.Literal("VOID"),
  t.Literal("REVERSED"),
]);
export type BoostStatusDto = Static<typeof BoostStatusSchema>;

export const PaymentStatusSchema = t.Union([
  t.Literal("CREATED"),
  t.Literal("PENDING"),
  t.Literal("CONFIRMED"),
  t.Literal("FAILED"),
  t.Literal("EXPIRED"),
  t.Literal("CANCELLED"),
  t.Literal("REFUNDED"),
]);
export type PaymentStatusDto = Static<typeof PaymentStatusSchema>;

export const ModerationStatusSchema = t.Union([
  t.Literal("PENDING_REVIEW"),
  t.Literal("APPROVED"),
  t.Literal("REJECTED"),
  t.Literal("REMOVED"),
  t.Literal("OPTOUT_VERIFICATION_PENDING"),
  t.Literal("OPTED_OUT"),
]);
export type ModerationStatusDto = Static<typeof ModerationStatusSchema>;

export const RejectionReasonSchema = t.Union([
  t.Literal("NOT_PUBLIC_OR_PROFESSIONAL"),
  t.Literal("MINOR"),
  t.Literal("DUPLICATE"),
  t.Literal("MALICIOUS_URL"),
  t.Literal("IMPERSONATION"),
  t.Literal("INVALID_PROFILE"),
  t.Literal("OTHER"),
]);
export type RejectionReasonDto = Static<typeof RejectionReasonSchema>;

export const ClaimStatusSchema = t.Union([
  t.Literal("UNCLAIMED"),
  t.Literal("PENDING"),
  t.Literal("CLAIMED"),
]);
export type ClaimStatusDto = Static<typeof ClaimStatusSchema>;

export const CreatorPlatformSchema = t.Union([
  t.Literal("INSTAGRAM"),
  t.Literal("TIKTOK"),
  t.Literal("YOUTUBE"),
  t.Literal("TWITCH"),
  t.Literal("X"),
  t.Literal("SPOTIFY"),
  t.Literal("SUBSTACK"),
  t.Literal("WEBSITE"),
]);
export type CreatorPlatformDto = Static<typeof CreatorPlatformSchema>;

export const RankingPeriodTypeSchema = t.Union([t.Literal("WEEKLY"), t.Literal("ALL_TIME")]);
export type RankingPeriodTypeDto = Static<typeof RankingPeriodTypeSchema>;

export const RankingPeriodStatusSchema = t.Union([t.Literal("OPEN"), t.Literal("CLOSED")]);
export type RankingPeriodStatusDto = Static<typeof RankingPeriodStatusSchema>;
