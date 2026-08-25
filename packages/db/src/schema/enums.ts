import {
  BOOST_STATUSES,
  CLAIM_STATUSES,
  CREATOR_PLATFORMS,
  DELIVERY_SURFACES,
  MODERATION_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_STATUSES,
  RANKING_PERIOD_STATUSES,
  RANKING_PERIOD_TYPES,
  REJECTION_REASONS,
} from "@creator-outdoor/domain";
import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Every enum is defined once in the domain package and projected into
 * PostgreSQL here, so an invalid state cannot be persisted even if application
 * code is wrong.
 */
export const boostStatusEnum = pgEnum("boost_status", BOOST_STATUSES);
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);
export const moderationStatusEnum = pgEnum("moderation_status", MODERATION_STATUSES);
export const rejectionReasonEnum = pgEnum("rejection_reason", REJECTION_REASONS);
export const claimStatusEnum = pgEnum("claim_status", CLAIM_STATUSES);
export const creatorPlatformEnum = pgEnum("creator_platform", CREATOR_PLATFORMS);
export const rankingPeriodTypeEnum = pgEnum("ranking_period_type", RANKING_PERIOD_TYPES);
export const rankingPeriodStatusEnum = pgEnum("ranking_period_status", RANKING_PERIOD_STATUSES);

/** Where a creator was displayed when an impression was counted. */
export const impressionSurfaceEnum = pgEnum("impression_surface", DELIVERY_SURFACES);

export const notificationTypeEnum = pgEnum("notification_type", NOTIFICATION_TYPES);

export const REPORT_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES);

/** Why a proof-of-ownership code was issued for a creator profile. */
export const VERIFICATION_PURPOSES = ["OPTOUT", "CLAIM"] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];
export const verificationPurposeEnum = pgEnum("verification_purpose", VERIFICATION_PURPOSES);

export const VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "EXPIRED", "CANCELLED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const verificationStatusEnum = pgEnum("verification_status", VERIFICATION_STATUSES);
