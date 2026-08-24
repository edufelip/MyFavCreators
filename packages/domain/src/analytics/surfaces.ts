/**
 * Where a creator was displayed when an impression was counted.
 *
 * Defined here and projected into PostgreSQL by `packages/db`, so an invalid
 * surface cannot be persisted even if application code is wrong.
 */
export const DELIVERY_SURFACES = [
  "MARQUEE",
  "LEADERBOARD",
  "ROTATION",
  "CREATOR_PAGE",
  "EMBED",
] as const;
export type DeliverySurface = (typeof DELIVERY_SURFACES)[number];

export function isDeliverySurface(value: unknown): value is DeliverySurface {
  return typeof value === "string" && DELIVERY_SURFACES.includes(value as DeliverySurface);
}
