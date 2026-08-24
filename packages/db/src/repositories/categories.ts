import { asc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import { categories } from "../schema";

export type CategoryRecord = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly isActive: boolean;
};

export async function listActiveCategories(
  executor: DatabaseExecutor,
): Promise<readonly CategoryRecord[]> {
  return executor
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      isActive: categories.isActive,
    })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.name));
}

export async function findCategoryBySlug(
  executor: DatabaseExecutor,
  slug: string,
): Promise<CategoryRecord | null> {
  const rows = await executor
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      isActive: categories.isActive,
    })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}
