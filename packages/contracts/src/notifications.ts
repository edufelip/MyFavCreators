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
