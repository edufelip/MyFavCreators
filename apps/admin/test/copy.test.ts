import { describe, expect, test } from "bun:test";
import { MODERATION_STATUSES, REJECTION_REASONS } from "@creator-outdoor/domain";
import { adminCopy } from "../src/lib/copy";

describe("administration copy", () => {
  test("labels every moderation status", () => {
    for (const status of MODERATION_STATUSES) {
      expect(adminCopy.statusLabels[status], status).toBeTruthy();
    }
    expect(Object.keys(adminCopy.statusLabels).sort()).toEqual([...MODERATION_STATUSES].sort());
  });

  test("labels every rejection reason", () => {
    for (const reason of REJECTION_REASONS) {
      expect(adminCopy.rejectionReasonLabels[reason], reason).toBeTruthy();
    }
    expect(Object.keys(adminCopy.rejectionReasonLabels).sort()).toEqual(
      [...REJECTION_REASONS].sort(),
    );
  });

  test("carries the full moderation checklist", () => {
    expect(adminCopy.moderation.checklist.items).toHaveLength(8);
    for (const item of adminCopy.moderation.checklist.items) {
      expect(item.endsWith("?")).toBe(true);
    }
  });

  test("states the boundary the admin app must preserve", () => {
    expect(adminCopy.boundary).toContain("nunca acessa o banco de dados");
  });
});
