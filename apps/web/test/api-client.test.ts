import { beforeEach, describe, expect, mock, test } from "bun:test";

/*
 * `apps/web/src/lib/api.ts` is a server module: it imports `server-only`, which
 * throws outside a server component, and `next/headers`, which needs a request.
 * Both are replaced here so the client's own rules — which status means what,
 * and what it tells the caller — can be tested without a browser and a stack.
 *
 * The rules are worth testing directly because getting one wrong is silent: a
 * caller that is told "saved" when nothing was saved looks exactly like a
 * caller that was told the truth.
 */
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { setCreatorNotifications, submitCreatorUrl } = await import("../src/lib/api");

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Response;

let handler: Handler = () => new Response(null, { status: 500 });

beforeEach(() => {
  /*
   * A real `fetch`, not a cast into one: `typeof fetch` carries `preconnect` as
   * well as the call signature. A no-op is a truthful implementation of it — a
   * connection hint with no observable result — and it is supplied rather than
   * borrowed from the real global, which the DOM these tests run in lacks.
   */
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => handler(input, init),
    { preconnect: () => {} },
  );
});

describe("recording what a creator agreed to be written about", () => {
  test("reports back what the API actually applied", async () => {
    handler = () =>
      Response.json({ notifyDethrone: true, notifyWeeklyRecap: false }, { status: 200 });
    expect(
      await setCreatorNotifications(
        "tok",
        { notifyDethrone: true, notifyWeeklyRecap: false },
        null,
      ),
    ).toEqual({ notifyDethrone: true, notifyWeeklyRecap: false });
  });

  test("reports what was applied even when it is not what was asked for", async () => {
    /*
     * The API answers 200 with both switches off when there is no usable
     * address to send to. Reading only the status turned that into "saved", so
     * somebody ticked a box, was told it worked, and was never notified.
     */
    handler = () =>
      Response.json({ notifyDethrone: false, notifyWeeklyRecap: false }, { status: 200 });
    expect(
      await setCreatorNotifications("tok", { notifyDethrone: true, notifyWeeklyRecap: true }, null),
    ).toEqual({ notifyDethrone: false, notifyWeeklyRecap: false });
  });

  test("reports nothing at all when the session was refused", async () => {
    /*
     * A 401 used to be swallowed and the creator was told their preference had
     * been saved. A consent switch that lies about having been flipped is worse
     * than one that refuses to flip.
     */
    handler = () =>
      Response.json({ error: { code: "UNAUTHORIZED", message: "" } }, { status: 401 });
    expect(
      await setCreatorNotifications(
        "stale",
        { notifyDethrone: false, notifyWeeklyRecap: false },
        null,
      ),
    ).toBe("SIGNED_OUT");
  });

  test("names a refused address rather than calling it a passing outage", async () => {
    /*
     * A 422 is the API saying the address cannot be used, and it is the one
     * failure here the creator can fix. Folded in with everything else it
     * reached the screen as "Não foi possível salvar agora. Tente novamente em
     * instantes." — advice that can never work for a typo, so the creator keeps
     * pressing the button.
     */
    handler = () =>
      Response.json({ error: { code: "INVALID_EMAIL", message: "" } }, { status: 422 });
    expect(
      await setCreatorNotifications(
        "tok",
        { notifyDethrone: true, notifyWeeklyRecap: false },
        "jose@exemplo",
      ),
    ).toBe("INVALID_EMAIL");
  });

  test("raises anything else, rather than reporting either outcome", async () => {
    handler = () => new Response(null, { status: 500 });
    expect(
      await setCreatorNotifications("tok", { notifyDethrone: true, notifyWeeklyRecap: true }, null)
        .then(() => "resolved")
        .catch(() => "threw"),
    ).toBe("threw");
  });
});

describe("a public write", () => {
  test("raises on a status the API should never answer with", async () => {
    for (const status of [404, 500, 502]) {
      handler = () => Response.json({ error: { code: "NOT_FOUND", message: "" } }, { status });
      expect(
        await submitCreatorUrl("https://instagram.com/alguem")
          .then(() => "resolved")
          .catch((error: unknown) => (error instanceof Error ? error.message : "unknown")),
        String(status),
      ).toContain(String(status));
    }
  });

  test("raises rather than returning a payload that does not match the contract", async () => {
    handler = () => Response.json({ nada: true }, { status: 200 });
    expect(
      await submitCreatorUrl("https://instagram.com/alguem")
        .then(() => "resolved")
        .catch(() => "threw"),
    ).toBe("threw");
  });
});
