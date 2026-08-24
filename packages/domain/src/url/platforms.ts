import type { CreatorPlatform } from "../creator/platform";

export type PlatformMatch = {
  readonly platform: CreatorPlatform;
  readonly handle: string;
  readonly normalizedKey: string;
  readonly canonicalUrl: string;
};

/** A handle segment: letters, digits, dot, underscore and dash only. */
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

function isHandle(segment: string | undefined): segment is string {
  return segment !== undefined && HANDLE_PATTERN.test(segment);
}

/**
 * Paths a platform owns itself. They are real URLs on the platform but they are
 * not creator profiles, so accepting one would create a creator nobody owns.
 */
const RESERVED: Readonly<Record<string, ReadonlySet<string>>> = {
  INSTAGRAM: new Set([
    "explore",
    "accounts",
    "reels",
    "reel",
    "p",
    "stories",
    "direct",
    "about",
    "developer",
  ]),
  TIKTOK: new Set([
    "explore",
    "foryou",
    "following",
    "live",
    "search",
    "tag",
    "music",
    "about",
    "legal",
  ]),
  TWITCH: new Set([
    "directory",
    "downloads",
    "jobs",
    "turbo",
    "settings",
    "subscriptions",
    "videos",
    "p",
    "login",
    "signup",
  ]),
  X: new Set([
    "home",
    "explore",
    "notifications",
    "messages",
    "settings",
    "i",
    "search",
    "compose",
    "login",
    "signup",
    "tos",
    "privacy",
  ]),
};

function isReserved(platform: string, segment: string): boolean {
  return RESERVED[platform]?.has(segment.toLowerCase()) ?? false;
}

/** `null` when this URL is not a creator profile on the platform. */
type Matcher = (segments: readonly string[], host: string) => PlatformMatch | null;

/**
 * A simple profile at `host/handle`, shared by Instagram, Twitch and X.
 */
function simpleHandleMatcher(
  platform: CreatorPlatform,
  canonicalHost: string,
  keyPrefix: string,
): Matcher {
  return (segments) => {
    const first = segments[0];
    if (!isHandle(first) || isReserved(platform, first)) {
      return null;
    }
    const handle = first.toLowerCase();
    return {
      platform,
      handle,
      normalizedKey: `${keyPrefix}:${handle}`,
      canonicalUrl: `https://${canonicalHost}/${handle}`,
    };
  };
}

const matchTikTok: Matcher = (segments) => {
  const bare = segments[0]?.replace(/^@/, "");
  if (!isHandle(bare) || isReserved("TIKTOK", bare)) {
    return null;
  }
  const handle = `@${bare.toLowerCase()}`;
  return {
    platform: "TIKTOK",
    handle,
    normalizedKey: `tiktok:${handle}`,
    canonicalUrl: `https://tiktok.com/${handle}`,
  };
};

const YOUTUBE_ID_SEGMENTS = new Set(["channel", "c", "user"]);

const matchYouTube: Matcher = (segments) => {
  const first = segments[0];
  if (first === undefined) {
    return null;
  }
  if (first.startsWith("@")) {
    const bare = first.slice(1);
    if (!isHandle(bare)) {
      return null;
    }
    const handle = `@${bare.toLowerCase()}`;
    return {
      platform: "YOUTUBE",
      handle,
      normalizedKey: `youtube:${handle}`,
      canonicalUrl: `https://youtube.com/${handle}`,
    };
  }
  if (!YOUTUBE_ID_SEGMENTS.has(first)) {
    // A video, playlist or search result names no creator on its own.
    return null;
  }
  const identifier = segments[1];
  return isHandle(identifier)
    ? {
        platform: "YOUTUBE",
        handle: identifier,
        normalizedKey: `youtube:${first}-${identifier}`,
        canonicalUrl: `https://youtube.com/${first}/${identifier}`,
      }
    : null;
};

const matchSpotify: Matcher = (segments) => {
  // Spotify prefixes localised URLs with an `intl-xx` segment.
  const first = segments[0];
  const withoutLocale =
    first !== undefined && /^intl-[a-z]{2}$/i.test(first) ? segments.slice(1) : segments;
  const [kind, identifier] = withoutLocale;
  return kind === "artist" && isHandle(identifier)
    ? {
        platform: "SPOTIFY",
        handle: identifier,
        normalizedKey: `spotify:${identifier}`,
        canonicalUrl: `https://open.spotify.com/artist/${identifier}`,
      }
    : null;
};

const matchSubstack: Matcher = (_segments, host) => {
  const publication = host.slice(0, -".substack.com".length);
  return isHandle(publication) && publication !== "www"
    ? {
        platform: "SUBSTACK",
        handle: publication,
        normalizedKey: `substack:${publication}`,
        canonicalUrl: `https://${publication}.substack.com`,
      }
    : null;
};

/** Exact hosts, each mapped to the matcher that understands its profile URLs. */
const HOST_MATCHERS: ReadonlyMap<string, Matcher> = new Map([
  ["instagram.com", simpleHandleMatcher("INSTAGRAM", "instagram.com", "instagram")],
  ["twitch.tv", simpleHandleMatcher("TWITCH", "twitch.tv", "twitch")],
  ["m.twitch.tv", simpleHandleMatcher("TWITCH", "twitch.tv", "twitch")],
  ["x.com", simpleHandleMatcher("X", "x.com", "x")],
  ["twitter.com", simpleHandleMatcher("X", "x.com", "x")],
  ["mobile.twitter.com", simpleHandleMatcher("X", "x.com", "x")],
  ["mobile.x.com", simpleHandleMatcher("X", "x.com", "x")],
  ["tiktok.com", matchTikTok],
  ["vm.tiktok.com", matchTikTok],
  ["youtube.com", matchYouTube],
  ["m.youtube.com", matchYouTube],
  ["music.youtube.com", matchYouTube],
  ["youtu.be", matchYouTube],
  ["open.spotify.com", matchSpotify],
  ["spotify.com", matchSpotify],
  ["play.spotify.com", matchSpotify],
  // The bare host is the platform's own site, never a publication.
  ["substack.com", () => null],
]);

/**
 * Recognises the supported platforms and reduces each URL to the creator it
 * identifies. A post or video URL still names the profile that owns it, so the
 * deep path is dropped rather than rejected.
 *
 * `segments` are already split and percent-decoded per segment by the caller, so
 * an encoded separator stays inside one segment and fails handle validation
 * instead of silently becoming a path boundary.
 *
 * Returns `null` when the host is not a known platform (the caller then treats
 * it as a personal website) and `"INVALID"` when it is a known platform but the
 * path is not a creator profile.
 */
export function matchPlatform(
  host: string,
  segments: readonly string[],
): PlatformMatch | null | "INVALID" {
  const matcher =
    HOST_MATCHERS.get(host) ?? (host.endsWith(".substack.com") ? matchSubstack : null);
  if (matcher === null) {
    return null;
  }
  return matcher(segments, host) ?? "INVALID";
}
