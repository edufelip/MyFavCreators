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
export const IMPRESSION_SURFACES = [
  "MARQUEE",
  "LEADERBOARD",
  "ROTATION",
  "CREATOR_PAGE",
  "EMBED",
] as const;
export type ImpressionSurface = (typeof IMPRESSION_SURFACES)[number];
export const impressionSurfaceEnum = pgEnum("impression_surface", IMPRESSION_SURFACES);

export const NOTIFICATION_TYPES = ["DETHRONE"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationTypeEnum = pgEnum("notification_type", NOTIFICATION_TYPES);

export const REPORT_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES);
