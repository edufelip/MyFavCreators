import { afterEach, describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { ImpressionReporter } from "../src/components/impression-reporter";

/**
 * What the delivery beacon actually puts on the wire.
 *
 * This exists because the reporter posted a bare array for the whole of its
 * life, the ingest route parses `{ entries }`, and the route answers 204
 * whatever it decides — so every real page view was dropped and nothing said
 * so. The shape is the contract between two files that never type-check
 * against each other, so it is asserted here rather than assumed.
 */
type Sent = { readonly url: string; readonly body: string };

function captureFetch(): { sent: Sent[]; restore: () => void } {
  const sent: Sent[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return {
    sent,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

let restoreFetch: (() => void) | null = null;

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("the delivery beacon", () => {
  test("posts the entries in the shape the ingest route parses", () => {
    const { sent, restore } = captureFetch();
    restoreFetch = restore;

    render(
      <ImpressionReporter
        entries={[
          { creatorId: "faac761a-932e-503e-b850-d6f13ee4ee16", surface: "MARQUEE" },
          { creatorId: "dc5f170d-236e-5a30-8256-babd71f5b5b3", surface: "LEADERBOARD" },
        ]}
      />,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("/api/impressions");

    const parsed: unknown = JSON.parse(sent[0]?.body ?? "null");
    expect(parsed).toEqual({
      entries: [
        { creatorId: "faac761a-932e-503e-b850-d6f13ee4ee16", surface: "MARQUEE" },
        { creatorId: "dc5f170d-236e-5a30-8256-babd71f5b5b3", surface: "LEADERBOARD" },
      ],
    });
  });

  test("sends nothing at all when the page displayed nobody", () => {
    const { sent, restore } = captureFetch();
    restoreFetch = restore;

    render(<ImpressionReporter entries={[]} />);
    expect(sent).toEqual([]);
  });
});
