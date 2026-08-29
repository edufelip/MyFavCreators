import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { ONE_CLICK_UNSUBSCRIBE_PATH, UNSUBSCRIBE_PAGE_PATH } from "@creator-outdoor/contracts";

/*
 * The route reaches the API through `@/lib/api`, a server module: it imports
 * `server-only`, which throws anywhere else, and `next/headers`, which needs a
 * request. Both are replaced so the route's own behaviour can be exercised
 * without a running stack — the same arrangement `api-client.test.ts` uses.
 */
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { GET, POST } = await import("../src/app/api/descadastrar/[token]/route");

/**
 * The one-click unsubscribe hop, from the emailed address to the API call.
 *
 * The integration suite already proves the other half: a token pulled out of a
 * real notification's link, posted to the API, really sets `disabled_at`. What
 * nothing covered is this hop — the address a mail client posts to, and whether
 * the token it carries reaches the API unchanged. Both failures here answer 204
 * and unsubscribe nobody, which is exactly the bug this route was written to
 * fix, wearing different clothes.
 */
const REAL_TOKEN = "K7mQ2vX9-pLd_R4tYw8ZnB1cJ6hFgS0aE3iU5oM7qW-";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Captures what the route asks the API for.
 *
 * `Object.assign` rather than a cast: Bun's `fetch` carries a `preconnect`
 * property, so a bare function is not assignable to it, and silencing that with
 * an assertion would be the one thing this file is arguing against.
 */
function captureApiCall(response: Response): {
  readonly calls: Array<{ url: string; body: string }>;
} {
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: String(input instanceof Request ? input.url : input),
        body: typeof init?.body === "string" ? init.body : "",
      });
      return response;
    },
    { preconnect: () => {} },
  );
  return { calls };
}

function acknowledged(): Response {
  return new Response(JSON.stringify({ acknowledged: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function params(token: string): { readonly params: Promise<{ readonly token: string }> } {
  return { params: Promise.resolve({ token }) };
}

describe("the address a mail client posts to", () => {
  test("is the path the API writes into every List-Unsubscribe header", () => {
    /*
     * The header names a path in one package and the route is a directory in
     * another, and nothing but this makes them the same path. They drifted
     * once: the header named the confirmation page, which has no POST handler,
     * so mail clients were served its HTML with a 200 and read that as success.
     */
    expect(
      existsSync(
        new URL(`../src/app${ONE_CLICK_UNSUBSCRIBE_PATH}/[token]/route.ts`, import.meta.url),
      ),
    ).toBe(true);
    expect(
      existsSync(new URL(`../src/app${UNSUBSCRIBE_PAGE_PATH}/[token]/page.tsx`, import.meta.url)),
    ).toBe(true);
  });

  test("is not the confirmation page, which cannot answer a POST", () => {
    expect(ONE_CLICK_UNSUBSCRIBE_PATH).not.toBe(UNSUBSCRIBE_PAGE_PATH);
    expect(
      existsSync(new URL(`../src/app${UNSUBSCRIBE_PAGE_PATH}/[token]/route.ts`, import.meta.url)),
    ).toBe(false);
  });
});

describe("one-click unsubscribe", () => {
  test("sends the API the token from the path, byte for byte", async () => {
    const captured = captureApiCall(acknowledged());

    const response = await POST(
      new Request("http://web/x", { method: "POST" }),
      params(REAL_TOKEN),
    );

    expect(response.status).toBe(204);
    expect(captured.calls).toHaveLength(1);
    expect(captured.calls[0]?.url).toContain("/v1/notifications/unsubscribe");
    // Parsed rather than matched as a substring: a token that arrived escaped,
    // truncated or double-decoded is a request the API answers 200 to while
    // unsubscribing nobody, which is indistinguishable from success here.
    expect(JSON.parse(captured.calls[0]?.body ?? "{}")).toEqual({ token: REAL_TOKEN });
  });

  test("does not re-encode a token Next already decoded", async () => {
    /*
     * Next decodes route parameters, so `params.token` is the real token. A
     * route that encoded it again would send `%2B` where the database holds
     * `+` — no error anywhere, and the subscription stays on.
     *
     * Today's tokens are base64url and contain nothing that needs escaping,
     * which is why this cannot be caught by using a real one: the bug would
     * appear the day the token scheme changes.
     */
    const awkward = "tem+mais/coisas=aqui e um espaço";
    const captured = captureApiCall(acknowledged());

    await POST(new Request("http://web/x", { method: "POST" }), params(awkward));

    expect(JSON.parse(captured.calls[0]?.body ?? "{}")).toEqual({ token: awkward });
  });

  test("answers 502 rather than 204 when the API refuses", async () => {
    // A mail client retries a 5xx. Answering 204 tells the reader they are
    // unsubscribed while the subscription is still on — the failure that
    // answers as though it succeeded.
    const captured = captureApiCall(new Response("nope", { status: 500 }));

    const response = await POST(
      new Request("http://web/x", { method: "POST" }),
      params(REAL_TOKEN),
    );

    expect(response.status).toBe(502);
    expect(captured.calls).toHaveLength(1);
  });

  test("answers 502 when the API cannot be reached at all", async () => {
    globalThis.fetch = Object.assign(
      async (): Promise<Response> => {
        throw new Error("connect ECONNREFUSED");
      },
      { preconnect: () => {} },
    );

    const response = await POST(
      new Request("http://web/x", { method: "POST" }),
      params(REAL_TOKEN),
    );
    expect(response.status).toBe(502);
  });
});

describe("a person who clicks the link", () => {
  test("is redirected to the confirmation page, and nothing is changed", async () => {
    // Mail clients prefetch links. A GET that unsubscribed would unsubscribe
    // people who never clicked, which is why the page exists at all.
    const captured = captureApiCall(acknowledged());

    const response = await GET(
      new Request(`http://web${ONE_CLICK_UNSUBSCRIBE_PATH}/${REAL_TOKEN}`),
      params(REAL_TOKEN),
    );

    expect(response.status).toBe(303);
    expect(captured.calls).toHaveLength(0);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe(`${UNSUBSCRIBE_PAGE_PATH}/${REAL_TOKEN}`);
  });

  test("reaches the page with an awkward token intact", async () => {
    const awkward = "tem+mais/coisas=aqui";
    const response = await GET(new Request("http://web/x"), params(awkward));

    const location = new URL(response.headers.get("location") ?? "");
    // Decoded back, because the assertion is about what the page receives —
    // Next decodes the parameter again on the other side.
    expect(decodeURIComponent(location.pathname.slice(UNSUBSCRIBE_PAGE_PATH.length + 1))).toBe(
      awkward,
    );
  });
});
