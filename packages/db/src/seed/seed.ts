import { PRODUCT_DEFAULTS, type ProductConfig } from "@creator-outdoor/config";
import { calculateRotationWindow, getWeeklyPeriod } from "@creator-outdoor/domain";
import { sql } from "drizzle-orm";
import type { Database } from "../client";
import { boosts, categories, creatorLinks, creators, payments } from "../schema";
import { withTransaction } from "../transaction";
import { DeterministicRandom, deterministicUuid, splitIntoBoostAmounts } from "./deterministic";
import {
  CATEGORY_FIXTURES,
  CREATOR_FIXTURES,
  SUPPORTER_MESSAGES,
  SUPPORTER_NAMES,
} from "./fixtures";
import { describeCreatorLink } from "./links";

const HISTORICAL_WEEKS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Tables the seed owns, in an order that satisfies every foreign key. */
const SEEDED_TABLES = [
  "rank_events",
  "creator_ranking_snapshots",
  "impressions",
  "outbound_clicks",
  "notification_subscriptions",
  "reports",
  "payment_events",
  "boosts",
  "payments",
  "creator_links",
  "creators",
  "ranking_periods",
  "categories",
] as const;

export type SeedOptions = {
  readonly now?: Date;
  readonly product?: ProductConfig;
};

export type SeedSummary = {
  readonly categories: number;
  readonly creators: number;
  readonly boosts: number;
  readonly confirmedCents: number;
};

type BoostDraft = {
  readonly creatorId: string;
  readonly amountCents: number;
  readonly confirmedAt: Date;
  readonly index: number;
  readonly weekOffset: number;
};

function supporterFor(
  random: DeterministicRandom,
  draft: BoostDraft,
): {
  anonymous: boolean;
  supporterName: string | null;
  supporterMessage: string | null;
  fanIdentityKey: string;
} {
  // One in six boosts is anonymous: it counts toward the creator's score but
  // must never appear in the public Torcida ranking.
  const anonymous = random.int(6) === 0;
  const supporterIndex = random.int(SUPPORTER_NAMES.length);
  const supporterName = SUPPORTER_NAMES[supporterIndex] ?? "Fã";
  const withMessage = random.int(3) === 0;
  return {
    anonymous,
    supporterName: anonymous ? null : supporterName,
    supporterMessage: anonymous || !withMessage ? null : random.pick(SUPPORTER_MESSAGES),
    // Stands in for the HMAC-derived key produced at checkout. Never public.
    fanIdentityKey: deterministicUuid(
      `fan:${draft.creatorId}:${supporterIndex}:${draft.weekOffset % 3}`,
    ),
  };
}

function spreadTimestamps(
  count: number,
  from: Date,
  to: Date,
  random: DeterministicRandom,
): Date[] {
  const span = Math.max(1, to.getTime() - from.getTime());
  const stamps: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const slotStart = from.getTime() + Math.floor((span * index) / count);
    const slotSize = Math.max(1, Math.floor(span / count));
    stamps.push(slotStart + random.int(slotSize));
  }
  return stamps.sort((a, b) => a - b).map((value) => new Date(value));
}

/**
 * Replaces all fixture data with a deterministic dataset.
 *
 * Safe to run repeatedly: it truncates the tables it owns and re-inserts rows
 * with stable identifiers inside a single transaction.
 */
export async function seedDatabase(
  database: Database,
  options: SeedOptions = {},
): Promise<SeedSummary> {
  const product = options.product ?? PRODUCT_DEFAULTS;
  const now = options.now ?? new Date();
  const currentPeriod = getWeeklyPeriod(now, product.timezone);
  const random = new DeterministicRandom("creator-outdoor-seed-v1");

  const categoryRows = CATEGORY_FIXTURES.map((fixture) => ({
    id: deterministicUuid(`category:${fixture.slug}`),
    slug: fixture.slug,
    name: fixture.name,
    isActive: fixture.isActive,
  }));
  const categoryIdBySlug = new Map(categoryRows.map((row) => [row.slug, row.id]));

  const creatorRows = CREATOR_FIXTURES.map((fixture) => {
    const categoryId = categoryIdBySlug.get(fixture.categorySlug);
    if (categoryId === undefined) {
      throw new Error(
        `Fixture "${fixture.slug}" references unknown category "${fixture.categorySlug}"`,
      );
    }
    const createdAt = new Date(now.getTime() - fixture.joinedDaysAgo * DAY_MS);
    return {
      id: deterministicUuid(`creator:${fixture.slug}`),
      slug: fixture.slug,
      displayName: fixture.displayName,
      bio: fixture.bio,
      avatarUrl: null,
      categoryId,
      claimStatus: "UNCLAIMED" as const,
      moderationStatus: "APPROVED" as const,
      createdAt,
      updatedAt: createdAt,
    };
  });

  const linkRows = CREATOR_FIXTURES.map((fixture, index) => {
    const creator = creatorRows[index];
    if (creator === undefined) {
      throw new Error(`Missing creator row for fixture "${fixture.slug}"`);
    }
    const descriptor = describeCreatorLink(fixture.platform, fixture.handle);
    return {
      id: deterministicUuid(`link:${fixture.slug}`),
      creatorId: creator.id,
      platform: fixture.platform,
      handle: descriptor.handle,
      url: descriptor.url,
      normalizedKey: descriptor.normalizedKey,
      isPrimary: true,
      createdAt: creator.createdAt,
    };
  });

  const drafts: BoostDraft[] = [];
  CREATOR_FIXTURES.forEach((fixture, fixtureIndex) => {
    const creator = creatorRows[fixtureIndex];
    if (creator === undefined) {
      return;
    }

    // Current week: confirmations land between the period start and now.
    const currentAmounts = splitIntoBoostAmounts(
      fixture.currentWeekCents,
      random,
      product.minBoostCents,
    );
    const currentFrom = new Date(
      Math.max(currentPeriod.startsAt.getTime(), creator.createdAt.getTime()),
    );
    const currentTo = new Date(Math.max(currentFrom.getTime() + 1, now.getTime() - 60_000));
    spreadTimestamps(currentAmounts.length, currentFrom, currentTo, random).forEach(
      (confirmedAt, index) => {
        const amountCents = currentAmounts[index];
        if (amountCents === undefined) {
          return;
        }
        drafts.push({ creatorId: creator.id, amountCents, confirmedAt, index, weekOffset: 0 });
      },
    );

    // Preceding weeks: spread the historical total across closed periods.
    const perWeek = Math.floor(fixture.historicalCents / HISTORICAL_WEEKS / 100) * 100;
    for (let week = 1; week <= HISTORICAL_WEEKS; week += 1) {
      const period = getWeeklyPeriod(now, product.timezone, -week);
      if (period.endsAt.getTime() <= creator.createdAt.getTime()) {
        continue;
      }
      const weekTotal =
        week === HISTORICAL_WEEKS
          ? fixture.historicalCents - perWeek * (HISTORICAL_WEEKS - 1)
          : perWeek;
      if (weekTotal < product.minBoostCents) {
        continue;
      }
      const amounts = splitIntoBoostAmounts(weekTotal, random, product.minBoostCents);
      const from = new Date(Math.max(period.startsAt.getTime(), creator.createdAt.getTime()));
      const to = new Date(Math.max(from.getTime() + 1, period.endsAt.getTime() - 60_000));
      spreadTimestamps(amounts.length, from, to, random).forEach((confirmedAt, index) => {
        const amountCents = amounts[index];
        if (amountCents === undefined) {
          return;
        }
        drafts.push({
          creatorId: creator.id,
          amountCents,
          confirmedAt,
          index,
          weekOffset: -week,
        });
      });
    }
  });

  const paymentRows = drafts.map((draft) => {
    const id = deterministicUuid(
      `payment:${draft.creatorId}:${draft.weekOffset}:${draft.index}:${draft.confirmedAt.getTime()}`,
    );
    return {
      id,
      provider: "seed",
      providerPaymentId: `seed_${id}`,
      amountCents: draft.amountCents,
      currency: product.currency,
      status: "CONFIRMED" as const,
      rawMetadata: { seed: true },
      createdAt: new Date(draft.confirmedAt.getTime() - 4 * 60_000),
      updatedAt: draft.confirmedAt,
      confirmedAt: draft.confirmedAt,
    };
  });

  const boostRows = drafts.map((draft, index) => {
    const payment = paymentRows[index];
    if (payment === undefined) {
      throw new Error("Missing payment row for boost draft");
    }
    const supporter = supporterFor(random, draft);
    const rotation = calculateRotationWindow(draft.confirmedAt, product.rotationHours);
    return {
      id: deterministicUuid(`boost:${payment.id}`),
      creatorId: draft.creatorId,
      amountCents: draft.amountCents,
      currency: product.currency,
      supporterName: supporter.supporterName,
      supporterMessage: supporter.supporterMessage,
      anonymous: supporter.anonymous,
      supporterEmail: null,
      fanIdentityKey: supporter.fanIdentityKey,
      paymentId: payment.id,
      status: "ACTIVE" as const,
      confirmedAt: draft.confirmedAt,
      rotationStartsAt: rotation.rotationStartsAt,
      rotationEndsAt: rotation.rotationEndsAt,
      createdAt: payment.createdAt,
      updatedAt: draft.confirmedAt,
    };
  });

  await withTransaction(database, async (tx) => {
    await tx.execute(
      sql.raw(`truncate table ${SEEDED_TABLES.join(", ")} restart identity cascade`),
    );
    await tx.insert(categories).values(categoryRows);
    await tx.insert(creators).values(creatorRows);
    await tx.insert(creatorLinks).values(linkRows);
    for (let offset = 0; offset < paymentRows.length; offset += 500) {
      await tx.insert(payments).values(paymentRows.slice(offset, offset + 500));
    }
    for (let offset = 0; offset < boostRows.length; offset += 500) {
      await tx.insert(boosts).values(boostRows.slice(offset, offset + 500));
    }
  });

  return {
    categories: categoryRows.length,
    creators: creatorRows.length,
    boosts: boostRows.length,
    confirmedCents: boostRows.reduce((total, row) => total + row.amountCents, 0),
  };
}
