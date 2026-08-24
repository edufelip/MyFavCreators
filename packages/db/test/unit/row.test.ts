import { describe, expect, test } from "bun:test";
import { DatabaseRowError, readJsonObject } from "../../src/row";

describe("readJsonObject", () => {
  test("accepts an already-parsed object, as the query builder returns", () => {
    expect(readJsonObject({ meta: { origin: "DIRECT" } }, "meta")).toEqual({ origin: "DIRECT" });
  });

  test("parses a JSON string, as a raw SQL result returns", () => {
    // Drizzle's query builder parses jsonb; `execute` with a raw statement does
    // not. Treating both alike is the whole point of this helper.
    expect(readJsonObject({ meta: '{"origin":"DIRECT"}' }, "meta")).toEqual({ origin: "DIRECT" });
  });

  test("treats a missing column as an empty object", () => {
    expect(readJsonObject({}, "meta")).toEqual({});
    expect(readJsonObject({ meta: null }, "meta")).toEqual({});
  });

  test("treats a JSON scalar or array as no object", () => {
    expect(readJsonObject({ meta: "[1,2,3]" }, "meta")).toEqual({});
    expect(readJsonObject({ meta: '"texto"' }, "meta")).toEqual({});
  });

  test("refuses invalid JSON rather than silently losing data", () => {
    expect(() => readJsonObject({ meta: "{not json" }, "meta")).toThrow(DatabaseRowError);
    expect(() => readJsonObject({ meta: 42 }, "meta")).toThrow(DatabaseRowError);
  });
});
