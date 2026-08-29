import { describe, expect, test } from "bun:test";
import {
  CreateBoostRequestDto,
  CreatorDashboardDto,
  matchesContract,
  parseContract,
  UnsubscribeRequestDto,
} from "../src";

/**
 * What a contract failure is allowed to say.
 *
 * Both apps log the message of an error they catch, and neither has the API's
 * sanitiser: `apps/web` has fourteen `console.error(..., error.message)` calls
 * on paths that carry an address, a supporter's name and message, and a
 * creator's URL. That is safe today for one reason only — a contract error
 * names the path and the constraint and never quotes the value.
 *
 * Which is a property nobody wrote down, and exactly the kind somebody removes
 * while making an error more helpful. Reporting the received value is the
 * obvious next thing to add to a validator, and the day it is added, an address
 * starts appearing in the web app's logs with no other change anywhere.
 */
function messageFor(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the contract to reject this payload");
}

/** Things that must never turn up in a message, in the fields that carry them. */
const SECRETS = [
  "ana.silva@example.com",
  "000201126580014br.gov.bcb.pix",
  "Boa sorte, Luna! - Ana",
  "co_manage=abcdef",
];

describe("a contract failure", () => {
  test("names the path and the rule, and never the value", () => {
    const message = messageFor(() =>
      parseContract(
        UnsubscribeRequestDto,
        // The realistic shape: one field wrong, and the rest of what the
        // request carried sitting beside it.
        { token: "curto", supporterEmail: SECRETS[0] ?? "", cookie: SECRETS[3] ?? "" },
        "UnsubscribeRequest",
      ),
    );
    expect(message).toContain("/token");
    expect(message).toContain("UnsubscribeRequest");
    for (const secret of SECRETS) {
      expect(message, secret).not.toContain(secret);
    }
    // Not even the offending value, which is the one a validator is most
    // tempted to quote — and the one that is an address as often as not.
    expect(message).not.toContain("curto");
  });

  test("never quotes a value nested inside the payload", () => {
    // The shape somebody reaches for when a request fails: the whole body,
    // wrong in one place and carrying everything the request carried.
    const message = messageFor(() =>
      parseContract(
        CreateBoostRequestDto,
        {
          amountCents: "quinhentos",
          supporterName: "Ana",
          supporterMessage: SECRETS[2] ?? "",
          supporterEmail: SECRETS[0] ?? "",
        },
        "CreateBoostRequest",
      ),
    );
    for (const secret of SECRETS) {
      expect(message, secret).not.toContain(secret);
    }
  });

  test("says nothing at all when the answer is only yes or no", () => {
    // `matchesContract` is the form used where a rejection is handled rather
    // than reported, so it must not build a message to throw away.
    expect(matchesContract(UnsubscribeRequestDto, { token: "curto" })).toBe(false);
    expect(matchesContract(UnsubscribeRequestDto, { token: "a".repeat(43) })).toBe(true);
  });

  test("still says enough to find the fault", () => {
    // The rule above is only worth keeping if the message stays useful: a
    // sanitiser that removed everything would pass it and help nobody.
    const message = messageFor(() =>
      parseContract(CreatorDashboardDto, { creatorSlug: "luna-verso" }, "CreatorDashboard"),
    );
    expect(message).toContain("CreatorDashboard");
    expect(message).toContain("/displayName");
    expect(message).toContain("Expected required property");
  });
});
