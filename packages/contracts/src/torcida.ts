import { type Static, Type as t } from "@sinclair/typebox";
import { AmountCents, IsoDateTime, Slug } from "./primitives";

/**
 * One entry on a creator's supporter wall.
 *
 * Carries nothing private. There is no email, no fan identity key and no
 * payment identifier here, and `id` is opaque and scoped to this creator, so
 * the wall cannot be used to follow a supporter from one profile to another.
 *
 * `supporterName` is null for an anonymous entry, and the anonymous label is
 * chosen by the presentation layer — the API never invents a display name.
 */
export const TorcidaEntryDto = t.Object(
  {
    id: t.String({ minLength: 16, maxLength: 64 }),
    supporterName: t.Union([t.String({ maxLength: 60 }), t.Null()]),
    message: t.Union([t.String({ maxLength: 140 }), t.Null()]),
    anonymous: t.Boolean(),
    amountCents: AmountCents,
    boostCount: t.Integer({ minimum: 1 }),
    lastBoostAt: IsoDateTime,
  },
  { $id: "TorcidaEntry" },
);
export type TorcidaEntryDto = Static<typeof TorcidaEntryDto>;

export const TorcidaDto = t.Object(
  {
    creatorSlug: Slug,
    window: t.Union([t.Literal("weekly"), t.Literal("all-time")]),
    entries: t.Array(TorcidaEntryDto),
    /**
     * Distinct supporters, counted the same way the ranking counts them. An
     * entry is a wall row; a supporter is a person, and one person who chose
     * anonymity for part of their boosts occupies two rows but is one supporter.
     */
    supporterCount: t.Integer({ minimum: 0 }),
    totalAmountCents: AmountCents,
    total: t.Integer({ minimum: 0 }),
  },
  { $id: "Torcida" },
);
export type TorcidaDto = Static<typeof TorcidaDto>;
