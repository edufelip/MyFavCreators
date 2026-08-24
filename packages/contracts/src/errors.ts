import { type Static, Type as t } from "@sinclair/typebox";

export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNPROCESSABLE",
  "RATE_LIMITED",
  "INTERNAL",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The only error body the public API returns. It never carries a stack trace,
 * a driver message or any internal identifier.
 */
export const ApiErrorDto = t.Object(
  {
    error: t.Object({
      code: t.Union(API_ERROR_CODES.map((code) => t.Literal(code))),
      message: t.String({ maxLength: 500 }),
    }),
  },
  { $id: "ApiError" },
);
export type ApiErrorDto = Static<typeof ApiErrorDto>;
