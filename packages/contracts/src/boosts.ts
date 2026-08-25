import { type Static, Type as t } from "@sinclair/typebox";
import { BoostStatusSchema, PaymentStatusSchema } from "./enums";
import { AmountCents, IsoDateTime, Slug, Uuid } from "./primitives";

export const BOOST_ORIGINS = ["DIRECT", "TAKE_FIRST_PLACE"] as const;
export type BoostOrigin = (typeof BOOST_ORIGINS)[number];

/**
 * `TAKE_FIRST_PLACE` records that checkout began from the *Assuma o #1* call to
 * action, which is what makes the rank quote disclosure mandatory on that
 * checkout screen.
 */
export const BoostOriginSchema = t.Union([t.Literal("DIRECT"), t.Literal("TAKE_FIRST_PLACE")]);

export const CreateBoostRequestDto = t.Object(
  {
    creatorSlug: Slug,
    amountCents: t.Integer({ minimum: 1, maximum: 100_000_00 }),
    origin: t.Optional(BoostOriginSchema),
    supporterName: t.Optional(t.String({ maxLength: 80 })),
    supporterMessage: t.Optional(t.String({ maxLength: 280 })),
    anonymous: t.Optional(t.Boolean()),
    supporterEmail: t.Optional(t.String({ maxLength: 254 })),
    /** Persistent browser identifier for the supporter. Never the analytics sid. */
    supporterKey: t.Optional(t.String({ minLength: 8, maxLength: 128 })),
    /**
     * What the payer agrees to be written about. Each notification is its own
     * question, because agreeing to hear about one is not agreeing to the
     * other. Absent means agreed to nothing.
     */
    notifyOnDethrone: t.Optional(t.Boolean()),
    notifyWeeklyRecap: t.Optional(t.Boolean()),
  },
  { $id: "CreateBoostRequest" },
);
export type CreateBoostRequestDto = Static<typeof CreateBoostRequestDto>;

/**
 * The checkout payload.
 *
 * Carries the PIX payload the customer needs and nothing that identifies the
 * payment at the provider: `providerPaymentId` stays server-side.
 */
export const CheckoutDto = t.Object(
  {
    paymentId: Uuid,
    boostId: Uuid,
    creatorSlug: Slug,
    creatorDisplayName: t.String({ maxLength: 120 }),
    amountCents: AmountCents,
    qrCode: t.String({ maxLength: 4096 }),
    copyPaste: t.String({ maxLength: 4096 }),
    expiresAt: IsoDateTime,
    origin: BoostOriginSchema,
    status: PaymentStatusSchema,
  },
  { $id: "Checkout" },
);
export type CheckoutDto = Static<typeof CheckoutDto>;

export const RankMovementDto = t.Object(
  {
    fromRank: t.Union([t.Integer({ minimum: 1 }), t.Null()]),
    toRank: t.Integer({ minimum: 1 }),
    positionsGained: t.Integer({ minimum: 0 }),
    direction: t.Union([t.Literal("UP"), t.Literal("DOWN"), t.Literal("NONE")]),
  },
  { $id: "RankMovement" },
);
export type RankMovementDto = Static<typeof RankMovementDto>;

/**
 * What the checkout screen polls.
 *
 * The frontend view of payment state is never authoritative; this is a read of
 * what the API and the provider have actually agreed on.
 */
export const PaymentStatusResponseDto = t.Object(
  {
    paymentId: Uuid,
    status: PaymentStatusSchema,
    boostStatus: BoostStatusSchema,
    creatorSlug: Slug,
    amountCents: AmountCents,
    confirmedAt: t.Union([IsoDateTime, t.Null()]),
    /** Present once the boost is active: the position actually reached. */
    movement: t.Union([RankMovementDto, t.Null()]),
    supporterCount: t.Union([t.Integer({ minimum: 0 }), t.Null()]),
  },
  { $id: "PaymentStatusResponse" },
);
export type PaymentStatusResponseDto = Static<typeof PaymentStatusResponseDto>;

export const SUPPORTER_KEY_COOKIE = "co_supporter";
export const ANALYTICS_SESSION_COOKIE = "co_sid";
