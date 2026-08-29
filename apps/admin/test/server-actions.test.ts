import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a `"use server"` module is allowed to export.
 *
 * Next may only export async functions from one. A `const` there compiles,
 * typechecks, lints clean, and passes every unit test — and then fails
 * `next build` with an error naming the closing brace of an unrelated function
 * three declarations further down. Nothing before the build says a word.
 *
 * The rule is small enough to check directly, so it is checked here, where the
 * failure names the line that broke it.
 */
const SOURCE_ROOT = new URL("../src/", import.meta.url).pathname;

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** Modules whose first statement is the directive, not merely any file naming it. */
function serverModules(): ReadonlyArray<{ path: string; source: string }> {
  return sourceFiles(SOURCE_ROOT)
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(({ source }) =>
      /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(source),
    );
}

/**
 * Exports that are not async functions.
 *
 * Type-only exports are erased before Next ever sees the module, so they are
 * fine and are excluded. Everything else — `const`, `let`, `class`, a plain
 * `function` — is the failure.
 */
function nonActionExports(source: string): readonly string[] {
  return source
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("export") &&
        !line.startsWith("export type ") &&
        !line.startsWith("export interface ") &&
        !line.startsWith("export async function "),
    )
    .map((line) => line.trim());
}

describe('a "use server" module', () => {
  test("is found at all, so this test cannot pass by looking at nothing", () => {
    const modules = serverModules();
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.map((module) => module.path.replace(SOURCE_ROOT, ""))).toContain(
      "lib/actions.ts",
    );
  });

  test("exports only async functions and types", () => {
    for (const { path, source } of serverModules()) {
      expect(nonActionExports(source), path.replace(SOURCE_ROOT, "")).toEqual([]);
    }
  });
});
