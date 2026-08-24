import type { ProductConfig } from "@creator-outdoor/config";
import type {
  BoostOrigin,
  CheckoutDto,
  PaymentStatusResponseDto,
} from "@creator-outdoor/contracts";
import {
  type CheckoutView,
  countCreatorsWithScoreAbove,
  type Database,
  findCreatorBySlug,
  getCheckoutView,
  getCreatorStanding,
  getPaymentStatusView,
  insertPaymentWithBoost,
  withTransaction,
} from "@creator-outdoor/db";
import {
  BoostAmountError,
  calculateRankMovement,
  centsValue,
  deriveFanIdentityKey,
  getWeeklyPeriod,
  isPubliclyEligible,
  resolveSupporterDetails,
  validateBoostAmount,
} from "@creator-outdoor/domain";
import type { PixPaymentProvider } from "../payments/provider";

export class CreatorNotBoostableError extends Error {
  override readonly name = "CreatorNotBoostableError";
}

export { BoostAmountError };

export type CreateBoostInput = {
  readonly creatorSlug: string;
  readonly amountCents: number;
  readonly origin: BoostOrigin;
  readonly supporterName?: string | undefined;
  readonly supporterMessage?: string | undefined;
  readonly anonymous?: boolean | undefined;
  readonly supporterEmail?: string | undefined;
  readonly supporterKey: string;
  readonly now: Date;
};

/**
 * Creates a boost and the PIX payment that funds it.
 *
 * Nothing about the ranking changes here. The boost is PENDING and the payment
 * is PENDING until the provider says the money settled — a customer closing the
 * tab, or a frontend that decides on its own that a payment worked, cannot move
 * a single centavo of anyone's score.
 */
export async function createBoost(
  database: Database,
  product: ProductConfig,
  provider: PixPaymentProvider,
  fanIdentitySecret: string,
  input: CreateBoostInput,
): Promise<CheckoutDto> {
  const creator = await findCreatorBySlug(database, input.creatorSlug);
  if (creator === null || !isPubliclyEligible(creator.moderationStatus)) {
    // Only an APPROVED creator may receive new boosts, and a creator who is not
    // public must be indistinguishable from one that never existed.
    throw new CreatorNotBoostableError(`No boostable creator for ${input.creatorSlug}`);
  }

  const amountCents = validateBoostAmount(input.amountCents, product.minBoostCents);
  const supporter = resolveSupporterDetails({
    anonymous: input.anonymous ?? false,
    supporterName: input.supporterName,
    supporterMessage: input.supporterMessage,
    nameMaxLength: product.supporterNameMax,
    messageMaxLength: product.supporterMessageMax,
  });
  const fanIdentityKey = deriveFanIdentityKey({
    secret: fanIdentitySecret,
    email: input.supporterEmail ?? null,
    supporterKey: input.supporterKey,
  });

  const externalRef = `${creator.slug}:${input.now.getTime()}`;
  const created = await provider.createPixPayment({
    amountCents: centsValue(amountCents),
    externalRef,
  });

  const { paymentId, boostId } = await withTransaction(database, (tx) =>
    insertPaymentWithBoost(tx, {
      provider: provider.name,
      providerPaymentId: created.providerPaymentId,
      amountCents: centsValue(amountCents),
      currency: product.currency,
      creatorId: creator.id,
      supporterName: supporter.supporterName,
      supporterMessage: supporter.supporterMessage,
      anonymous: supporter.anonymous,
      // Stored privately for receipts and notifications; never public.
      supporterEmail: input.supporterEmail ?? null,
      fanIdentityKey,
      // The PIX payload lives with the payment so the checkout screen can be
      // reloaded, or reopened on another device, without ever putting it in a URL.
      rawMetadata: {
        origin: input.origin,
        externalRef,
        qrCode: created.qrCode,
        copyPaste: created.copyPaste,
        expiresAt: created.expiresAt.toISOString(),
      },
    }),
  );

  return {
    paymentId,
    boostId,
    creatorSlug: creator.slug,
    creatorDisplayName: creator.displayName,
    amountCents: centsValue(amountCents),
    qrCode: created.qrCode,
    copyPaste: created.copyPaste,
    expiresAt: created.expiresAt.toISOString(),
    origin: input.origin,
    status: "PENDING",
  };
}

/**
 * The authoritative payment state, plus the movement the customer actually got.
 *
 * The movement is computed after confirmation from the live ranking, never from
 * the quote the customer saw: the leaderboard may have moved while the PIX was
 * pending, and the success screen has to show the real result.
 */
export async function getPaymentStatusResponse(
  database: Database,
  product: ProductConfig,
  paymentId: string,
  now: Date,
): Promise<PaymentStatusResponseDto | null> {
  const view = await getPaymentStatusView(database, paymentId);
  if (view === null) {
    return null;
  }

  let movement: PaymentStatusResponseDto["movement"] = null;
  let supporterCount: number | null = null;

  if (view.boostStatus === "ACTIVE" && view.status === "CONFIRMED") {
    const creator = await findCreatorBySlug(database, view.creatorSlug);
    if (creator !== null) {
      const period = getWeeklyPeriod(now, product.timezone);
      const standing = await getCreatorStanding(database, creator.id, {
        startsAt: period.startsAt,
        endsAt: period.endsAt,
      });
      if (standing.rank !== null) {
        const before = await rankBeforeThisBoost(
          database,
          product,
          creator.id,
          view.amountCents,
          now,
        );
        movement = calculateRankMovement(before, standing.rank);
        supporterCount = standing.supporterCount;
      }
    }
  }

  return {
    paymentId,
    status: view.status,
    boostStatus: view.boostStatus,
    creatorSlug: view.creatorSlug,
    amountCents: view.amountCents,
    confirmedAt: view.confirmedAt?.toISOString() ?? null,
    movement,
    supporterCount,
  };
}

/**
 * Where the creator would stand without this boost.
 *
 * Derived rather than remembered: subtracting the boost from the creator's
 * current score and re-reading the ranking gives the position the boost moved
 * them from, without storing a snapshot that a later refund would invalidate.
 */
async function rankBeforeThisBoost(
  database: Database,
  product: ProductConfig,
  creatorId: string,
  boostAmountCents: number,
  now: Date,
): Promise<number | null> {
  const period = getWeeklyPeriod(now, product.timezone);
  const standing = await getCreatorStanding(database, creatorId, {
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  });
  const withoutBoost = standing.amountCents - boostAmountCents;
  if (withoutBoost <= 0) {
    // The creator had no counted money before this boost: they entered the
    // ranking rather than moving inside it.
    return null;
  }
  const ahead = await countCreatorsWithScoreAbove(database, {
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    amountCents: withoutBoost,
    // Without this the creator's own post-boost total counts as somebody ahead
    // of their pre-boost total, and every repeat boost claims a position gained.
    excludeCreatorId: creatorId,
  });
  return ahead + 1;
}

function readString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

/**
 * Rebuilds the checkout payload from the stored payment.
 *
 * Returns `null` for an unknown payment. The provider identifier is not part of
 * the view at all, so it cannot leak through this route either.
 */
export async function getCheckout(
  database: Database,
  paymentId: string,
): Promise<CheckoutDto | null> {
  const view: CheckoutView | null = await getCheckoutView(database, paymentId);
  if (view === null) {
    return null;
  }
  const copyPaste = readString(view.metadata, "copyPaste");
  const qrCode = readString(view.metadata, "qrCode");
  const expiresAt = readString(view.metadata, "expiresAt");
  if (copyPaste === null || qrCode === null || expiresAt === null) {
    return null;
  }
  return {
    paymentId: view.paymentId,
    boostId: view.boostId,
    creatorSlug: view.creatorSlug,
    creatorDisplayName: view.creatorDisplayName,
    amountCents: view.amountCents,
    qrCode,
    copyPaste,
    expiresAt,
    origin:
      readString(view.metadata, "origin") === "TAKE_FIRST_PLACE" ? "TAKE_FIRST_PLACE" : "DIRECT",
    status: view.status,
  };
}
