import type { ProductConfig } from "@creator-outdoor/config";
import type { TorcidaDto, TorcidaEntryDto } from "@creator-outdoor/contracts";
import {
  type Database,
  findCreatorBySlug,
  getTorcidaPage,
  type TorcidaEntryRow,
  type TorcidaWindow,
} from "@creator-outdoor/db";
import { centsValue, getWeeklyPeriod, isPubliclyEligible } from "@creator-outdoor/domain";

export type TorcidaRequest = {
  readonly slug: string;
  readonly window: "weekly" | "all-time";
  readonly limit: number;
  readonly offset: number;
  readonly now: Date;
};

/**
 * The public supporter wall for one creator.
 *
 * Returns `null` for anything not APPROVED, exactly like the creator page: a
 * hidden creator's supporters are not a way to discover that the creator
 * exists.
 */
export async function getTorcida(
  database: Database,
  product: ProductConfig,
  request: TorcidaRequest,
): Promise<TorcidaDto | null> {
  const creator = await findCreatorBySlug(database, request.slug);
  if (creator === null || !isPubliclyEligible(creator.moderationStatus)) {
    return null;
  }

  const page = await getTorcidaPage(database, {
    creatorId: creator.id,
    window: resolveWindow(product, request),
    limit: request.limit,
    offset: request.offset,
  });

  return {
    creatorSlug: creator.slug,
    window: request.window,
    entries: page.entries.map(serializeEntry),
    supporterCount: page.supporterCount,
    totalAmountCents: centsValue(page.totalAmountCents),
    total: page.total,
  };
}

function resolveWindow(product: ProductConfig, request: TorcidaRequest): TorcidaWindow {
  if (request.window === "all-time") {
    return null;
  }
  const period = getWeeklyPeriod(request.now, product.timezone);
  return { startsAt: period.startsAt, endsAt: period.endsAt };
}

/**
 * An anonymous entry is serialized without a name even though the query already
 * dropped it. Two independent guards, because the cost of one of them being
 * wrong is publishing a name somebody asked to keep off the wall.
 */
function serializeEntry(entry: TorcidaEntryRow): TorcidaEntryDto {
  return {
    id: entry.id,
    supporterName: entry.anonymous ? null : entry.supporterName,
    message: entry.message,
    anonymous: entry.anonymous,
    amountCents: centsValue(entry.amountCents),
    boostCount: entry.boostCount,
    lastBoostAt: entry.lastBoostAt.toISOString(),
  };
}
