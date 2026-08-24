import { type DeliverySurface, isDeliverySurface } from "./surfaces";

/**
 * The most impressions one page render can honestly report.
 *
 * A page shows a marquee, a rotation feed and a leaderboard page; anything far
 * beyond that is a client that is wrong or a client that is lying, and neither
 * deserves a database write.
 */
export const IMPRESSION_BATCH_MAX = 120;

export type ImpressionInput = {
  readonly creatorId: string;
  readonly surface: DeliverySurface;
};

export class InvalidImpressionBatchError extends Error {
  override readonly name = "InvalidImpressionBatchError";
}

/**
 * Normalizes one page's worth of impressions.
 *
 * A creator shown twice on the same surface in one render is one impression:
 * the same event reported twice is not two deliveries. Collapsing here means
 * the database's uniqueness index is a backstop rather than the only defence,
 * and the caller never has to reason about a partially-applied batch.
 */
export function validateImpressionBatch(
  entries: readonly ImpressionInput[],
): readonly ImpressionInput[] {
  if (entries.length === 0) {
    throw new InvalidImpressionBatchError("Um lote de exibicoes nao pode ser vazio");
  }
  if (entries.length > IMPRESSION_BATCH_MAX) {
    throw new InvalidImpressionBatchError(
      `Um lote de exibicoes aceita no maximo ${IMPRESSION_BATCH_MAX} entradas`,
    );
  }

  const seen = new Set<string>();
  const unique: ImpressionInput[] = [];
  for (const entry of entries) {
    if (!isDeliverySurface(entry.surface)) {
      throw new InvalidImpressionBatchError(`Superficie desconhecida: ${String(entry.surface)}`);
    }
    const key = `${entry.creatorId} ${entry.surface}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({ creatorId: entry.creatorId, surface: entry.surface });
  }
  return unique;
}
