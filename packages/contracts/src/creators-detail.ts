import { type Static, Type as t } from "@sinclair/typebox";
import { CategoryDto } from "./creator";
import { ClaimStatusSchema, CreatorPlatformSchema } from "./enums";
import { AmountCents, IsoDateTime, Slug, Uuid } from "./primitives";

export const CreatorLinkDto = t.Object(
  {
    id: Uuid,
    platform: CreatorPlatformSchema,
    handle: t.String({ maxLength: 120 }),
    /** Always the tracked redirect, never the raw destination. */
    outboundUrl: t.String({ maxLength: 512 }),
    isPrimary: t.Boolean(),
  },
  { $id: "CreatorLink" },
);
export type CreatorLinkDto = Static<typeof CreatorLinkDto>;

export const CreatorStandingDto = t.Object(
  {
    /** Null when the creator has no counted money in the window. */
    rank: t.Union([t.Integer({ minimum: 1 }), t.Null()]),
    amountCents: AmountCents,
    supporterCount: t.Integer({ minimum: 0 }),
    takeFirstPlaceAmountCents: t.Union([AmountCents, t.Null()]),
  },
  { $id: "CreatorStanding" },
);
export type CreatorStandingDto = Static<typeof CreatorStandingDto>;

/**
 * The public creator page payload.
 *
 * An explicit allowlist: moderation metadata, normalized keys, supporter
 * identities and every private column are structurally absent.
 */
export const CreatorDetailDto = t.Object(
  {
    id: Uuid,
    slug: Slug,
    displayName: t.String({ minLength: 1, maxLength: 120 }),
    bio: t.Union([t.String({ maxLength: 500 }), t.Null()]),
    avatarUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]),
    category: CategoryDto,
    claimStatus: ClaimStatusSchema,
    links: t.Array(CreatorLinkDto),
    weekly: CreatorStandingDto,
    allTime: CreatorStandingDto,
    period: t.Object({ startsAt: IsoDateTime, endsAt: IsoDateTime }),
    /** Closed weeks this creator finished #1. Powers the champion badge. */
    championWeeks: t.Integer({ minimum: 0 }),
    createdAt: IsoDateTime,
  },
  { $id: "CreatorDetail" },
);
export type CreatorDetailDto = Static<typeof CreatorDetailDto>;

export const CreatorSubmissionRequestDto = t.Object(
  {
    url: t.String({ minLength: 3, maxLength: 512 }),
    categorySlug: t.Optional(Slug),
  },
  { $id: "CreatorSubmissionRequest" },
);
export type CreatorSubmissionRequestDto = Static<typeof CreatorSubmissionRequestDto>;

export const CREATOR_SUBMISSION_OUTCOMES = [
  "SUBMITTED",
  "ALREADY_EXISTS",
  "ALREADY_PENDING",
  "SUPPRESSED",
  "INVALID_URL",
] as const;
export type CreatorSubmissionOutcome = (typeof CREATOR_SUBMISSION_OUTCOMES)[number];

export const CreatorSubmissionOutcomeSchema = t.Union([
  t.Literal("SUBMITTED"),
  t.Literal("ALREADY_EXISTS"),
  t.Literal("ALREADY_PENDING"),
  t.Literal("SUPPRESSED"),
  t.Literal("INVALID_URL"),
]);

export const CreatorSubmissionResponseDto = t.Object(
  {
    outcome: CreatorSubmissionOutcomeSchema,
    /** Present only when an approved creator with this identity is already public. */
    creatorSlug: t.Union([Slug, t.Null()]),
    /** A human-readable pt-BR explanation, safe to render verbatim. */
    message: t.String({ maxLength: 300 }),
  },
  { $id: "CreatorSubmissionResponse" },
);
export type CreatorSubmissionResponseDto = Static<typeof CreatorSubmissionResponseDto>;

export const REPORT_REASONS = [
  "IMPERSONATION",
  "NOT_A_PUBLIC_CREATOR",
  "MINOR",
  "MALICIOUS_OR_HARMFUL",
  "WRONG_INFORMATION",
  "OTHER",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const ReportReasonSchema = t.Union([
  t.Literal("IMPERSONATION"),
  t.Literal("NOT_A_PUBLIC_CREATOR"),
  t.Literal("MINOR"),
  t.Literal("MALICIOUS_OR_HARMFUL"),
  t.Literal("WRONG_INFORMATION"),
  t.Literal("OTHER"),
]);

export const CreatorReportRequestDto = t.Object(
  {
    reason: ReportReasonSchema,
    details: t.Optional(t.String({ maxLength: 1000 })),
  },
  { $id: "CreatorReportRequest" },
);
export type CreatorReportRequestDto = Static<typeof CreatorReportRequestDto>;

export const OptOutRequestDto = t.Object(
  { contactEmail: t.Optional(t.String({ maxLength: 254 })) },
  { $id: "OptOutRequest" },
);
export type OptOutRequestDto = Static<typeof OptOutRequestDto>;

export const OptOutChallengeDto = t.Object(
  {
    /** The code to place on the profile. It proves control of the profile. */
    code: t.String({ maxLength: 32 }),
    expiresAt: IsoDateTime,
    instructions: t.String({ maxLength: 400 }),
  },
  { $id: "OptOutChallenge" },
);
export type OptOutChallengeDto = Static<typeof OptOutChallengeDto>;

export const OPT_OUT_VERIFICATION_OUTCOMES = [
  "VERIFIED",
  "CODE_NOT_FOUND",
  "NO_OPEN_REQUEST",
  "EXPIRED",
] as const;
export type OptOutVerificationOutcome = (typeof OPT_OUT_VERIFICATION_OUTCOMES)[number];

export const OptOutVerificationRequestDto = t.Object(
  {
    /**
     * The profile text the requester says now carries the code. Verification is
     * a text match the requester supplies; the platform does not scrape.
     */
    profileText: t.String({ minLength: 1, maxLength: 4000 }),
  },
  { $id: "OptOutVerificationRequest" },
);
export type OptOutVerificationRequestDto = Static<typeof OptOutVerificationRequestDto>;

export const OptOutVerificationOutcomeSchema = t.Union([
  t.Literal("VERIFIED"),
  t.Literal("CODE_NOT_FOUND"),
  t.Literal("NO_OPEN_REQUEST"),
  t.Literal("EXPIRED"),
]);

export const OptOutVerificationResponseDto = t.Object(
  {
    outcome: OptOutVerificationOutcomeSchema,
    message: t.String({ maxLength: 300 }),
  },
  { $id: "OptOutVerificationResponse" },
);
export type OptOutVerificationResponseDto = Static<typeof OptOutVerificationResponseDto>;

export const AcknowledgementDto = t.Object(
  { ok: t.Boolean(), message: t.String({ maxLength: 300 }) },
  { $id: "Acknowledgement" },
);
export type AcknowledgementDto = Static<typeof AcknowledgementDto>;
