import { type Static, Type as t } from "@sinclair/typebox";
import { IsoDateTime, Slug } from "./primitives";

export const ClaimChallengeDto = t.Object(
  {
    code: t.String({ minLength: 4, maxLength: 32 }),
    expiresAt: IsoDateTime,
    instructions: t.String({ maxLength: 400 }),
  },
  { $id: "ClaimChallenge" },
);
export type ClaimChallengeDto = Static<typeof ClaimChallengeDto>;

export const CLAIM_VERIFICATION_OUTCOMES = [
  "VERIFIED",
  "CODE_NOT_FOUND",
  "EXPIRED",
  "NO_OPEN_REQUEST",
] as const;
export type ClaimVerificationOutcome = (typeof CLAIM_VERIFICATION_OUTCOMES)[number];

export const ClaimVerificationOutcomeSchema = t.Union([
  t.Literal("VERIFIED"),
  t.Literal("CODE_NOT_FOUND"),
  t.Literal("EXPIRED"),
  t.Literal("NO_OPEN_REQUEST"),
]);

export const ClaimRequestDto = t.Object({}, { $id: "ClaimRequest" });

export const ClaimVerificationRequestDto = t.Object(
  {
    profileText: t.String({ minLength: 1, maxLength: 4000 }),
    email: t.Optional(t.String({ maxLength: 254 })),
  },
  { $id: "ClaimVerificationRequest" },
);
export type ClaimVerificationRequestDto = Static<typeof ClaimVerificationRequestDto>;

export const ClaimVerificationResponseDto = t.Object(
  {
    outcome: ClaimVerificationOutcomeSchema,
    message: t.String({ maxLength: 300 }),
    /**
     * The management token, returned exactly once. Only its hash is stored, so
     * a lost token is re-issued by proving the claim again, never recovered.
     */
    manageToken: t.Union([t.String({ minLength: 20, maxLength: 128 }), t.Null()]),
  },
  { $id: "ClaimVerificationResponse" },
);
export type ClaimVerificationResponseDto = Static<typeof ClaimVerificationResponseDto>;

export const CreatorProfileUpdateDto = t.Object(
  {
    bio: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
    categorySlug: t.Optional(Slug),
  },
  { $id: "CreatorProfileUpdate" },
);
export type CreatorProfileUpdateDto = Static<typeof CreatorProfileUpdateDto>;

/** What a claimed creator sees about their own profile. Never public. */
export const CreatorDashboardDto = t.Object(
  {
    creatorSlug: Slug,
    displayName: t.String({ maxLength: 120 }),
    bio: t.Union([t.String({ maxLength: 500 }), t.Null()]),
    categorySlug: Slug,
    weeklyRank: t.Union([t.Integer({ minimum: 1 }), t.Null()]),
    weeklyAmountCents: t.Integer({ minimum: 0 }),
    allTimeAmountCents: t.Integer({ minimum: 0 }),
    supporterCount: t.Integer({ minimum: 0 }),
    impressions: t.Integer({ minimum: 0 }),
    outboundClicks: t.Integer({ minimum: 0 }),
    clickThroughRate: t.Union([t.Number({ minimum: 0, maximum: 1 }), t.Null()]),
    championWeeks: t.Integer({ minimum: 0 }),
    notifyDethrone: t.Boolean(),
  },
  { $id: "CreatorDashboard" },
);
export type CreatorDashboardDto = Static<typeof CreatorDashboardDto>;

export const NotificationPreferenceDto = t.Object(
  { notifyDethrone: t.Boolean() },
  { $id: "NotificationPreference" },
);
export type NotificationPreferenceDto = Static<typeof NotificationPreferenceDto>;
