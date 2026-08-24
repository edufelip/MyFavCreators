import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SRC_ROOT = join(import.meta.dir, "..", "src");

async function readSourceFiles(
  directory: string,
): Promise<Array<{ path: string; source: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Array<{ path: string; source: string }> = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readSourceFiles(entryPath)));
    } else if (entry.name.endsWith(".ts")) {
      files.push({ path: entryPath, source: await readFile(entryPath, "utf8") });
    }
  }
  return files;
}

/** Import specifiers, so a word appearing inside a prose comment is not a match. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
}

describe("architectural boundaries", () => {
  test("the domain package imports no infrastructure", () => {
    const forbidden = [
      "react",
      "next",
      "elysia",
      "drizzle-orm",
      "drizzle-kit",
      "pg",
      "postgres",
      "bun:sqlite",
      "zod",
      "@creator-outdoor/db",
      "@creator-outdoor/contracts",
      "@creator-outdoor/config",
      "@creator-outdoor/testkit",
    ];
    return readSourceFiles(SRC_ROOT).then((files) => {
      for (const file of files) {
        for (const specifier of importSpecifiers(file.source)) {
          const isRelative = specifier.startsWith(".");
          const isAllowedNodeBuiltin = specifier.startsWith("node:");
          expect(isRelative || isAllowedNodeBuiltin, `${file.path} imports "${specifier}"`).toBe(
            true,
          );
          expect(forbidden).not.toContain(specifier);
        }
      }
    });
  });

  test("the ranking module never references analytics", async () => {
    // Money is the only ranking signal. Impressions, outbound clicks, CTR and
    // every external engagement metric are structurally absent from ranking.
    const forbiddenIdentifiers = [
      "Impression",
      "impression",
      "OutboundClick",
      "outboundClick",
      "clickCount",
      "ctr",
      "CTR",
      "follower",
      "subscriber",
      "watchTime",
      "engagement",
    ];
    const rankingFiles = await readSourceFiles(join(SRC_ROOT, "ranking"));
    expect(rankingFiles.length).toBeGreaterThan(0);
    for (const file of rankingFiles) {
      // Strip comments: the prohibition is on code, and the comments explain it.
      const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const identifier of forbiddenIdentifiers) {
        expect(code.includes(identifier), `${file.path} references "${identifier}"`).toBe(false);
      }
    }
  });
});
