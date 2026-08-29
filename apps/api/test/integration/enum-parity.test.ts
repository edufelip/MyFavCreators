import { afterAll, describe, expect, test } from "bun:test";
import { schema } from "@creator-outdoor/db";
// These three are owned by the db package rather than the domain: they describe
// a row's bookkeeping, not a rule anybody outside applies. Where a list lives
// does not change what this test is for.
import * as enums from "@creator-outdoor/db/schema/enums";
import {
  BOOST_STATUSES,
  CLAIM_STATUSES,
  CREATOR_PLATFORMS,
  DELIVERY_SURFACES,
  MODERATION_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_STATUSES,
  RANKING_PERIOD_STATUSES,
  RANKING_PERIOD_TYPES,
  REJECTION_REASONS,
} from "@creator-outdoor/domain";
import { createTestDatabase, type TestDatabase } from "@creator-outdoor/testkit";

/**
 * The domain's enums against the database's own.
 *
 * The contract package proves its unions match the domain, and the schema is
 * declared from the domain lists — but a `pgEnum` declaration is not the
 * database. What the database holds was written by a migration, and a value
 * added to a domain list without one compiles, passes every other test, and
 * fails on the first insert that uses it.
 *
 * This is the third side of a triangle whose other two were already checked.
 * It needs a real database, which is why it lives here rather than in a unit
 * test — and the integration suite already has one.
 */
const testDatabase: TestDatabase = await createTestDatabase();

afterAll(async () => {
  await testDatabase.close();
});

async function labelsOf(typeName: string): Promise<string[]> {
  const rows = (await testDatabase.db.execute(
    `select e.enumlabel as label
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
     where t.typname = '${typeName}'
     order by e.enumsortorder` as never,
  )) as Array<Record<string, unknown>>;
  return rows.map((row) => String(row["label"]));
}

const PAIRS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["boost_status", BOOST_STATUSES],
  ["payment_status", PAYMENT_STATUSES],
  ["moderation_status", MODERATION_STATUSES],
  ["rejection_reason", REJECTION_REASONS],
  ["claim_status", CLAIM_STATUSES],
  ["creator_platform", CREATOR_PLATFORMS],
  ["ranking_period_type", RANKING_PERIOD_TYPES],
  ["ranking_period_status", RANKING_PERIOD_STATUSES],
  ["impression_surface", DELIVERY_SURFACES],
  ["notification_type", NOTIFICATION_TYPES],
  ["report_status", schema.REPORT_STATUSES],
  ["verification_purpose", schema.VERIFICATION_PURPOSES],
  ["verification_status", schema.VERIFICATION_STATUSES],
];

/**
 * The `pgEnum`s the schema declares.
 *
 * Read from the enums module itself, not from the `schema` barrel. The barrel
 * re-exports by explicit name, so an enum somebody adds and forgets to list
 * there is invisible to this check — while still being perfectly usable, since
 * the tables import from `./enums` directly. That is the same blind spot one
 * level up: a check that reads a hand-maintained list cannot see what is
 * missing from it.
 *
 * Drizzle builds a `pgEnum` as a callable carrying `enumName` and `enumValues`,
 * which is what distinguishes one from the plain arrays exported beside them.
 * Narrowed with `in` rather than an assertion, so nothing here claims a shape
 * the runtime has not shown.
 */
type DeclaredEnum = { readonly enumName: string; readonly enumValues: readonly string[] };

function declaredEnums(): readonly DeclaredEnum[] {
  /*
   * Rebuilt rather than narrowed with a predicate. A `value is DeclaredEnum`
   * guard has to be assignable to the union `Object.values` produces, and
   * Drizzle's `PgEnum` carries more than the two properties this needs — so
   * the guard would only compile with an assertion, which is the one thing a
   * test about two sides agreeing must not do.
   */
  return Object.values(enums).flatMap((value) => {
    if (typeof value !== "function" || !("enumName" in value) || !("enumValues" in value)) {
      return [];
    }
    return [{ enumName: value.enumName, enumValues: [...value.enumValues] }];
  });
}

function declaredEnumNames(): readonly string[] {
  return declaredEnums()
    .map((enumeration) => enumeration.enumName)
    .sort();
}

describe("every database enum holds exactly what the domain says", () => {
  for (const [typeName, domainValues] of PAIRS) {
    test(`${typeName}`, async () => {
      const labels = await labelsOf(typeName);
      expect(labels.length, `${typeName} is missing from the database`).toBeGreaterThan(0);
      // Sorted, because the order a migration adds values in is not the order
      // the domain happens to list them and neither order means anything.
      expect([...labels].sort()).toEqual([...domainValues].sort());
    });
  }

  test("covers every enum the database holds", async () => {
    /*
     * Otherwise this file rots the way the contract parity check did: a new
     * enum is added, nobody adds it here, and the guarantee quietly shrinks.
     */
    const rows = (await testDatabase.db.execute(
      `select t.typname as name
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       where t.typtype = 'e' and n.nspname = 'public'` as never,
    )) as Array<Record<string, unknown>>;

    const inDatabase = rows.map((row) => String(row["name"])).sort();
    expect(inDatabase).toEqual(PAIRS.map(([name]) => name).sort());
  });

  test("covers every enum the schema declares", () => {
    /*
     * The blind spot the check above cannot see.
     *
     * It compares the database against this file, so it catches an enum that
     * was migrated and never listed. An enum *declared* in the schema and never
     * migrated is in neither set: not in the database, so that check is
     * satisfied, and not in `PAIRS`, so nothing is missing from it either. The
     * first insert using it is where anybody finds out.
     *
     * Read from the schema module rather than listed by hand, because a list
     * that has to be updated alongside another list is the thing this test
     * exists to replace.
     */
    expect(declaredEnumNames().length).toBeGreaterThan(0);
    expect(declaredEnumNames()).toEqual(PAIRS.map(([name]) => name).sort());
  });

  test("declares exactly the values the domain lists", () => {
    // Cheap, and it localises the failure: a declaration that drifted from the
    // domain fails here, naming the enum, instead of failing above as a
    // database that disagrees with a list nobody has looked at yet.
    for (const [name, domainValues] of PAIRS) {
      const declared = declaredEnums().find((enumeration) => enumeration.enumName === name);
      expect(
        declared?.enumValues === undefined ? null : [...declared.enumValues].sort(),
        name,
      ).toEqual([...domainValues].sort());
    }
  });
});
