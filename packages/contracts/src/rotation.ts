import { type Static, Type as t } from "@sinclair/typebox";
import { CreatorSummaryDto } from "./creator";
import { AmountCents, IsoDateTime, Slug } from "./primitives";

export const RotationEntryDto = t.Object(
  {
    creator: CreatorSummaryDto,
    weeklyAmountCents: AmountCents,
    /** When this creator's entitlement ends. */
    rotationEndsAt: IsoDateTime,
  },
  { $id: "RotationEntry" },
);
export type RotationEntryDto = Static<typeof RotationEntryDto>;

export const RotationResponseDto = t.Object(
  {
    entries: t.Array(RotationEntryDto),
    /** How many creators are entitled right now, which may exceed what is shown. */
    eligibleCount: t.Integer({ minimum: 0 }),
    generatedAt: IsoDateTime,
    /** The selection is stable within a bucket and rotates when it advances. */
    bucket: t.Integer({ minimum: 0 }),
  },
  { $id: "RotationResponse" },
);
export type RotationResponseDto = Static<typeof RotationResponseDto>;

export const RankEventDto = t.Object(
  {
    id: t.String({ maxLength: 64 }),
    creatorSlug: Slug,
    creatorDisplayName: t.String({ maxLength: 120 }),
    passedCreatorSlug: t.Union([Slug, t.Null()]),
    passedCreatorDisplayName: t.Union([t.String({ maxLength: 120 }), t.Null()]),
    fromRank: t.Integer({ minimum: 1 }),
    toRank: t.Integer({ minimum: 1 }),
    createdAt: IsoDateTime,
  },
  { $id: "RankEvent" },
);
export type RankEventDto = Static<typeof RankEventDto>;

export const RankEventListDto = t.Object(
  { events: t.Array(RankEventDto) },
  { $id: "RankEventList" },
);
export type RankEventListDto = Static<typeof RankEventListDto>;

export const ChampionDto = t.Object(
  {
    creator: CreatorSummaryDto,
    amountCents: AmountCents,
    supporterCount: t.Integer({ minimum: 0 }),
    periodStartsAt: IsoDateTime,
    periodEndsAt: IsoDateTime,
  },
  { $id: "Champion" },
);
export type ChampionDto = Static<typeof ChampionDto>;

export const HallOfFameDto = t.Object({ champions: t.Array(ChampionDto) }, { $id: "HallOfFame" });
export type HallOfFameDto = Static<typeof HallOfFameDto>;
