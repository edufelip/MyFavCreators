import {
  type DatabaseExecutor,
  getLeaderboardPage,
  type LeaderboardWindow,
  schema,
} from "@creator-outdoor/db";
import type {
  BoostStatus,
  CreatorPlatform,
  ModerationStatus,
  PaymentStatus,
} from "@creator-outdoor/domain";

let sequence = 0;
function nextSequence(): number {
  sequence += 1;
  return sequence;
}

export function resetFactorySequence(): void {
  sequence = 0;
}

export type CategoryInput = {
  readonly slug?: string;
  readonly name?: string;
  readonly isActive?: boolean;
};

export type CategoryFixtureRow = { readonly id: string; readonly slug: string };

export async function insertCategory(
  executor: DatabaseExecutor,
  input: CategoryInput = {},
): Promise<CategoryFixtureRow> {
  const index = nextSequence();
  const slug = input.slug ?? `categoria-${index}`;
  const rows = await executor
    .insert(schema.categories)
    .values({
      slug,
      name: input.name ?? `Categoria ${index}`,
      isActive: input.isActive ?? true,
    })
    .returning({ id: schema.categories.id, slug: schema.categories.slug });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Failed to insert category fixture");
  }
  return row;
}

export type CreatorInput = {
  readonly categoryId: string;
  readonly slug?: string;
  readonly displayName?: string;
  readonly moderationStatus?: ModerationStatus;
  readonly createdAt?: Date;
  readonly platform?: CreatorPlatform;
  readonly handle?: string;
  readonly withLink?: boolean;
};

export type CreatorFixtureRow = {
  readonly id: string;
  readonly slug: string;
  readonly createdAt: Date;
};

export async function insertCreator(
  executor: DatabaseExecutor,
  input: CreatorInput,
): Promise<CreatorFixtureRow> {
  const index = nextSequence();
  const slug = input.slug ?? `criador-${index}`;
  const createdAt = input.createdAt ?? new Date("2026-01-01T00:00:00.000Z");
  const rows = await executor
    .insert(schema.creators)
    .values({
      slug,
      displayName: input.displayName ?? `Criador ${index}`,
      categoryId: input.categoryId,
      moderationStatus: input.moderationStatus ?? "APPROVED",
      createdAt,
      updatedAt: createdAt,
    })
    .returning({
      id: schema.creators.id,
      slug: schema.creators.slug,
      createdAt: schema.creators.createdAt,
    });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Failed to insert creator fixture");
  }

  if (input.withLink !== false) {
    const handle = input.handle ?? slug.replace(/-/g, "");
    await executor.insert(schema.creatorLinks).values({
      creatorId: row.id,
      platform: input.platform ?? "YOUTUBE",
      handle: `@${handle}`,
      url: `https://youtube.com/@${handle}`,
      normalizedKey: `youtube:@${handle}-${index}`,
      isPrimary: true,
      createdAt,
    });
  }

  return row;
}

export type BoostInput = {
  readonly creatorId: string;
  readonly amountCents: number;
  /** When the payment settled. Required for a boost that should rank. */
  readonly confirmedAt?: Date | undefined;
  readonly boostStatus?: BoostStatus;
  readonly paymentStatus?: PaymentStatus;
  readonly anonymous?: boolean;
  readonly fanIdentityKey?: string | undefined;
  readonly supporterName?: string | undefined;
  readonly supporterEmail?: string | undefined;
  readonly supporterMessage?: string | undefined;
};

export type BoostFixtureRow = { readonly boostId: string; readonly paymentId: string };

/**
 * Inserts a payment and the boost it funds.
 *
 * Defaults produce the only combination that ranks — an ACTIVE boost behind a
 * CONFIRMED payment — so a test opts explicitly into every other state.
 */
export async function insertBoost(
  executor: DatabaseExecutor,
  input: BoostInput,
): Promise<BoostFixtureRow> {
  const index = nextSequence();
  const paymentStatus = input.paymentStatus ?? "CONFIRMED";
  const boostStatus = input.boostStatus ?? "ACTIVE";
  const confirmedAt =
    input.confirmedAt ??
    (paymentStatus === "CONFIRMED" ? new Date("2026-08-19T12:00:00.000Z") : null);

  const paymentRows = await executor
    .insert(schema.payments)
    .values({
      provider: "test",
      providerPaymentId: `test_payment_${index}`,
      amountCents: input.amountCents,
      currency: "BRL",
      status: paymentStatus,
      confirmedAt: paymentStatus === "CONFIRMED" ? confirmedAt : null,
      refundedAt: paymentStatus === "REFUNDED" ? confirmedAt : null,
    })
    .returning({ id: schema.payments.id });
  const payment = paymentRows[0];
  if (payment === undefined) {
    throw new Error("Failed to insert payment fixture");
  }

  const boostRows = await executor
    .insert(schema.boosts)
    .values({
      creatorId: input.creatorId,
      amountCents: input.amountCents,
      currency: "BRL",
      anonymous: input.anonymous ?? false,
      supporterName: input.supporterName ?? null,
      supporterMessage: input.supporterMessage ?? null,
      supporterEmail: input.supporterEmail ?? null,
      fanIdentityKey: input.fanIdentityKey ?? null,
      paymentId: payment.id,
      status: boostStatus,
      confirmedAt: boostStatus === "ACTIVE" ? confirmedAt : null,
    })
    .returning({ id: schema.boosts.id });
  const boost = boostRows[0];
  if (boost === undefined) {
    throw new Error("Failed to insert boost fixture");
  }
  return { boostId: boost.id, paymentId: payment.id };
}

/** Reads the whole ranking, which keeps assertions about order easy to write. */
export async function readWholeLeaderboard(
  executor: DatabaseExecutor,
  window: LeaderboardWindow,
  categorySlug?: string,
) {
  return getLeaderboardPage(executor, {
    window,
    limit: 100,
    offset: 0,
    ...(categorySlug === undefined ? {} : { categorySlug }),
  });
}
