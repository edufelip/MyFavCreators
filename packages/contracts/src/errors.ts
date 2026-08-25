import { type Static, Type as t } from "@sinclair/typebox";

export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNPROCESSABLE",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "PROVIDER_UNAVAILABLE",
  "INTERNAL",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The only error body the API returns. It never carries a stack trace, a driver
 * message or any internal identifier.
 *
 * The literals are written out rather than mapped from `API_ERROR_CODES`: a
 * `.map()` over the tuple erases the literal types, which silently degrades
 * every handler that returns one. `test/enums.test.ts` keeps the two in step.
 */
export const ApiErrorCodeSchema = t.Union([
  t.Literal("BAD_REQUEST"),
  t.Literal("NOT_FOUND"),
  t.Literal("UNPROCESSABLE"),
  t.Literal("RATE_LIMITED"),
  t.Literal("UNAUTHORIZED"),
  t.Literal("PROVIDER_UNAVAILABLE"),
  t.Literal("INTERNAL"),
]);

export const ApiErrorDto = t.Object(
  {
    error: t.Object({
      code: ApiErrorCodeSchema,
      message: t.String({ maxLength: 500 }),
    }),
  },
  { $id: "ApiError" },
);
export type ApiErrorDto = Static<typeof ApiErrorDto>;
