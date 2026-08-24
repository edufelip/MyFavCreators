import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** Every file that participates in producing a ranking. */
const RANKING_SOURCES = [
  join(REPOSITORY_ROOT, "packages", "db", "src", "repositories", "rankings.ts"),
  join(REPOSITORY_ROOT, "apps", "api", "src", "services", "rankings.ts"),
  join(REPOSITORY_ROOT, "apps", "api", "src", "serializers", "rankings.ts"),
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("ranking has no analytics dependency", () => {
  test("no ranking source references an analytics table or metric", async () => {
    const forbidden = [
      "impressions",
      "impression",
      "outbound_clicks",
      "outboundClick",
      "ctr",
      "follower",
      "subscriber",
      "engagement",
      "watch_time",
    ];
    for (const path of RANKING_SOURCES) {
      const code = stripComments(await readFile(path, "utf8"));
      for (const identifier of forbidden) {
        expect(code.includes(identifier), `${path} references "${identifier}"`).toBe(false);
      }
    }
  });

  test("the ranking query filters on boost and payment status only", async () => {
    const sql = await readFile(RANKING_SOURCES[0] ?? "", "utf8");
    expect(sql.includes("b.status = 'ACTIVE'")).toBe(true);
    expect(sql.includes("p.status = 'CONFIRMED'")).toBe(true);
    expect(sql.includes("c.moderation_status = 'APPROVED'")).toBe(true);
  });
});

describe("web and admin never reach the database", () => {
  test("neither app declares a database dependency", async () => {
    for (const app of ["web", "admin"]) {
      const manifest = await readFile(join(REPOSITORY_ROOT, "apps", app, "package.json"), "utf8");
      expect(manifest.includes("drizzle-orm")).toBe(false);
      expect(manifest.includes("drizzle-kit")).toBe(false);
      expect(manifest.includes("@creator-outdoor/db")).toBe(false);
    }
  });
});
