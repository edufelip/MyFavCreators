import { type Static, Type as t } from "@sinclair/typebox";
import { CreatorPlatformSchema } from "./enums";
import { Slug, Uuid } from "./primitives";

export const CategoryDto = t.Object(
  {
    slug: Slug,
    name: t.String({ minLength: 1, maxLength: 80 }),
  },
  { $id: "Category" },
);
export type CategoryDto = Static<typeof CategoryDto>;

/**
 * The categories a visitor can browse.
 *
 * Only the slug and the name. A public endpoint that also returned the row's id
 * or its active flag would be publishing an internal identifier somebody would
 * then start depending on.
 */
export const CategoryListDto = t.Object(
  { categories: t.Array(CategoryDto) },
  { $id: "CategoryList" },
);
export type CategoryListDto = Static<typeof CategoryListDto>;

/**
 * The public shape of a creator.
 *
 * This is an explicit allowlist, never a serialized database row. Moderation
 * metadata, claim internals, supporter identifiers and every other private
 * column are structurally absent.
 */
export const CreatorSummaryDto = t.Object(
  {
    id: Uuid,
    slug: Slug,
    displayName: t.String({ minLength: 1, maxLength: 120 }),
    avatarUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]),
    category: CategoryDto,
    primaryPlatform: t.Union([CreatorPlatformSchema, t.Null()]),
    primaryHandle: t.Union([t.String({ maxLength: 120 }), t.Null()]),
  },
  { $id: "CreatorSummary" },
);
export type CreatorSummaryDto = Static<typeof CreatorSummaryDto>;
