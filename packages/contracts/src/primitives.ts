import { type Static, Type as t } from "@sinclair/typebox";

/**
 * A UTC ISO-8601 instant. Validated by pattern rather than by `format` so the
 * check works everywhere without registering a format resolver.
 */
export const IsoDateTime = t.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$",
  description: "UTC ISO-8601 instant",
});
export type IsoDateTime = Static<typeof IsoDateTime>;

/** A non-negative integer amount of BRL centavos. Money is never a float. */
export const AmountCents = t.Integer({
  minimum: 0,
  description: "Amount in BRL centavos",
});

export const Slug = t.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 120 });
export type Slug = Static<typeof Slug>;

export const Uuid = t.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});

export const CurrencyCode = t.Literal("BRL");

export function toIsoDateTime(value: Date): IsoDateTime {
  return value.toISOString();
}
