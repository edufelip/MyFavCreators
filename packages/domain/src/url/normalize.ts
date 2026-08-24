import type { CreatorPlatform } from "../creator/platform";
import { isUnsafeHost } from "./host";
import { matchPlatform } from "./platforms";

export const URL_REJECTION_REASONS = [
  "INVALID_URL",
  "UNSUPPORTED_PROTOCOL",
  "EMBEDDED_CREDENTIALS",
  "PRIVATE_HOST",
  "INVALID_PROFILE_URL",
] as const;
export type UrlRejectionReason = (typeof URL_REJECTION_REASONS)[number];

export type NormalizedCreatorUrl = {
  readonly ok: true;
  readonly platform: CreatorPlatform;
  readonly handle: string;
  readonly canonicalUrl: string;
  /** The deduplication identity, unique across the whole platform. */
  readonly normalizedKey: string;
};

export type RejectedCreatorUrl = {
  readonly ok: false;
  readonly reason: UrlRejectionReason;
};

export type CreatorUrlResult = NormalizedCreatorUrl | RejectedCreatorUrl;

function reject(reason: UrlRejectionReason): RejectedCreatorUrl {
  return { ok: false, reason };
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = { "http:": "80", "https:": "443" };

/**
 * Splits a path into decoded segments, or `null` when it cannot be trusted.
 *
 * Split first, decode second: decoding the whole path before splitting would let
 * an encoded separator (`%2F`) become a real path boundary and smuggle a handle
 * past validation.
 */
function decodePathSegments(pathname: string): string[] | null {
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    if (raw === "") {
      continue;
    }
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "." || segment === "..") {
      return null;
    }
    segments.push(segment);
  }
  return segments;
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Reduces a submitted URL to the creator it identifies.
 *
 * Runs before any deduplication, so two spellings of the same profile collide on
 * `normalizedKey` rather than creating two creators competing for the same
 * fandom's money. It is also the security boundary for submitted URLs: unsafe
 * protocols, embedded credentials and hosts inside the infrastructure never make
 * it into the database, an outbound link, or a metadata fetch.
 *
 * Pure and idempotent: normalizing a canonical URL returns the same result.
 */
export function normalizeCreatorUrl(input: string): CreatorUrlResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return reject("INVALID_URL");
  }

  // A scheme-less input is a convenience, not an invitation to guess a scheme:
  // anything that already carries one must carry an allowed one.
  const explicitScheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (explicitScheme !== null) {
    const scheme = (explicitScheme[1] ?? "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      return reject("UNSUPPORTED_PROTOCOL");
    }
  }

  const url = parse(explicitScheme === null ? `https://${trimmed}` : trimmed);
  if (url === null || url.hostname === "") {
    return reject("INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject("UNSUPPORTED_PROTOCOL");
  }
  if (url.username !== "" || url.password !== "") {
    return reject("EMBEDDED_CREDENTIALS");
  }
  if (isUnsafeHost(url.hostname)) {
    return reject("PRIVATE_HOST");
  }

  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (host === "") {
    return reject("INVALID_URL");
  }

  const segments = decodePathSegments(url.pathname);
  if (segments === null) {
    return reject("INVALID_PROFILE_URL");
  }

  const matched = matchPlatform(host, segments);
  if (matched === "INVALID") {
    return reject("INVALID_PROFILE_URL");
  }
  if (matched !== null) {
    return {
      ok: true,
      platform: matched.platform,
      handle: matched.handle,
      canonicalUrl: matched.canonicalUrl,
      normalizedKey: matched.normalizedKey,
    };
  }

  // Anything else is a personal website, identified by its canonical origin.
  const port = url.port === "" || url.port === DEFAULT_PORTS[url.protocol] ? "" : `:${url.port}`;
  const authority = `${host}${port}`;
  return {
    ok: true,
    platform: "WEBSITE",
    handle: authority,
    canonicalUrl: `https://${authority}`,
    normalizedKey: `site:${authority}`,
  };
}
