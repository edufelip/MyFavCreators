import { z } from "zod";

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Origins are compared verbatim against the browser `Origin` header, so they
 * must be a scheme, host and optional port — no path, query or fragment — and
 * only over http(s). Anything else is a configuration error, not a coincidence.
 */
export const originSchema = z
  .string()
  .refine((value) => {
    const url = parseUrl(value);
    return (
      url !== null &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  }, "must be an http(s) origin with no path, query, fragment or credentials")
  .transform((value) => new URL(value).origin);

export const portSchema = z.coerce.number().int().min(1).max(65535);
