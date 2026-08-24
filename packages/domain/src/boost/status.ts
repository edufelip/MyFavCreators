export const BOOST_STATUSES = ["PENDING", "ACTIVE", "VOID", "REVERSED"] as const;
export type BoostStatus = (typeof BOOST_STATUSES)[number];

export function isBoostStatus(value: unknown): value is BoostStatus {
  return typeof value === "string" && (BOOST_STATUSES as readonly string[]).includes(value);
}

/** Only an ACTIVE boost has ever delivered promotion. */
export function isRankableBoostStatus(status: BoostStatus): boolean {
  return status === "ACTIVE";
}
