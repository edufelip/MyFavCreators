import { type Static, Type as t } from "@sinclair/typebox";

/**
 * The answer to an unsubscribe request.
 *
 * Deliberately the same whether the token was live, already used, or never
 * existed: a differing answer would turn the unsubscribe link into an oracle
 * for whether an address is subscribed, and the link travels in email, where
 * anyone forwarded a copy can try it.
 */
export const UnsubscribeResponseDto = t.Object(
  { acknowledged: t.Literal(true) },
  { $id: "UnsubscribeResponse" },
);
export type UnsubscribeResponseDto = Static<typeof UnsubscribeResponseDto>;

export const UnsubscribeRequestDto = t.Object(
  { token: t.String({ minLength: 16, maxLength: 128 }) },
  { $id: "UnsubscribeRequest" },
);
export type UnsubscribeRequestDto = Static<typeof UnsubscribeRequestDto>;

/**
 * Where a mail client posts a one-click unsubscribe.
 *
 * Here rather than in either app because two of them have to agree about it and
 * neither can see the other: the API writes this path into every notification's
 * `List-Unsubscribe` header, and the web app serves it from a directory whose
 * name is the route. They agreed by memory once, and were wrong — the header
 * named `/descadastrar/`, the confirmation *page*, which has no POST handler.
 * Mail clients were served the page's own HTML with a 200, read that as
 * success, and told the reader they were unsubscribed while the subscription
 * stayed active.
 *
 * A test asserts the web app really serves this path, so the constant cannot
 * drift from the directory the way the two literals drifted from each other.
 */
export const ONE_CLICK_UNSUBSCRIBE_PATH = "/api/descadastrar";

/** Where a person who clicks the link is sent, to confirm before anything changes. */
export const UNSUBSCRIBE_PAGE_PATH = "/descadastrar";
