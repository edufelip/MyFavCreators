import { describe, expect, test } from "bun:test";
import { normalizeCreatorUrl, type UrlRejectionReason } from "../src/url";

function expectAccepted(input: string) {
  const result = normalizeCreatorUrl(input);
  if (!result.ok) {
    throw new Error(`Expected "${input}" to be accepted, rejected with ${result.reason}`);
  }
  return result;
}

function expectRejected(input: string, reason?: UrlRejectionReason) {
  const result = normalizeCreatorUrl(input);
  expect(result.ok, `Expected "${input}" to be rejected`).toBe(false);
  if (!result.ok && reason !== undefined) {
    expect(result.reason, `"${input}" rejection reason`).toBe(reason);
  }
  return result;
}

describe("protocol and shape", () => {
  test("requires http or https", () => {
    expectRejected("ftp://instagram.com/lunaverso", "UNSUPPORTED_PROTOCOL");
    expectRejected("file:///etc/passwd", "UNSUPPORTED_PROTOCOL");
    expectRejected("ws://instagram.com/lunaverso", "UNSUPPORTED_PROTOCOL");
  });

  test("rejects data: and javascript: outright", () => {
    expectRejected("data:text/html;base64,PHNjcmlwdD4=", "UNSUPPORTED_PROTOCOL");
    expectRejected("javascript:alert(document.cookie)", "UNSUPPORTED_PROTOCOL");
    expectRejected("JavaScript:alert(1)", "UNSUPPORTED_PROTOCOL");
    expectRejected("  javascript:alert(1)  ", "UNSUPPORTED_PROTOCOL");
  });

  test("rejects input that is not a URL at all", () => {
    expectRejected("", "INVALID_URL");
    expectRejected("   ", "INVALID_URL");
    expectRejected("not a url", "INVALID_URL");
    expectRejected("http://", "INVALID_URL");
  });

  test("accepts a bare host by assuming https", () => {
    const result = expectAccepted("instagram.com/lunaverso");
    expect(result.canonicalUrl).toBe("https://instagram.com/lunaverso");
  });

  test("rejects embedded credentials", () => {
    expectRejected("https://user:senha@instagram.com/lunaverso", "EMBEDDED_CREDENTIALS");
    expectRejected("https://user@instagram.com/lunaverso", "EMBEDDED_CREDENTIALS");
  });
});

describe("host safety", () => {
  test("rejects localhost and loopback", () => {
    for (const host of [
      "http://localhost/lunaverso",
      "http://localhost:8080/lunaverso",
      "http://127.0.0.1/x",
      "http://127.1/x",
      "http://[::1]/x",
      "http://0.0.0.0/x",
      "http://LOCALHOST/x",
    ]) {
      expectRejected(host, "PRIVATE_HOST");
    }
  });

  test("rejects private networks", () => {
    for (const host of [
      "http://10.0.0.5/x",
      "http://10.255.255.255/x",
      "http://172.16.0.1/x",
      "http://172.31.255.254/x",
      "http://192.168.1.1/x",
      "http://[fc00::1]/x",
      "http://[fd12:3456::1]/x",
    ]) {
      expectRejected(host, "PRIVATE_HOST");
    }
  });

  test("rejects link-local and metadata addresses", () => {
    for (const host of [
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.0.1/x",
      "http://[fe80::1]/x",
    ]) {
      expectRejected(host, "PRIVATE_HOST");
    }
  });

  test("rejects other reserved ranges an attacker could reach", () => {
    for (const host of [
      "http://100.64.0.1/x",
      "http://192.0.0.1/x",
      "http://198.18.0.1/x",
      "http://224.0.0.1/x",
      "http://255.255.255.255/x",
    ]) {
      expectRejected(host, "PRIVATE_HOST");
    }
  });

  test("rejects internal-only hostnames", () => {
    expectRejected("http://api.internal/x", "PRIVATE_HOST");
    expectRejected("http://db.local/x", "PRIVATE_HOST");
    expectRejected("http://service.localhost/x", "PRIVATE_HOST");
    expectRejected("http://host/x", "PRIVATE_HOST");
  });

  test("does not confuse a public host that merely looks private", () => {
    expectAccepted("https://instagram.com/localhost");
    expectAccepted("https://instagram.com/10.0.0.1");
  });

  test("rejects a decimal or hexadecimal encoded loopback address", () => {
    expectRejected("http://2130706433/x", "PRIVATE_HOST");
    expectRejected("http://0x7f000001/x", "PRIVATE_HOST");
  });
});

describe("canonicalization", () => {
  test("lowercases the host and strips www", () => {
    const result = expectAccepted("https://WWW.Instagram.COM/LunaVerso");
    expect(result.canonicalUrl).toBe("https://instagram.com/lunaverso");
  });

  test("removes the query string, the fragment and a trailing slash", () => {
    const result = expectAccepted("https://instagram.com/lunaverso/?igshid=abc#posts");
    expect(result.canonicalUrl).toBe("https://instagram.com/lunaverso");
  });

  test("maps twitter.com to x.com", () => {
    const result = expectAccepted("https://twitter.com/biametronomo");
    expect(result.platform).toBe("X");
    expect(result.canonicalUrl).toBe("https://x.com/biametronomo");
    expect(result.normalizedKey).toBe("x:biametronomo");
  });

  test("maps mobile and short twitter hosts too", () => {
    expect(expectAccepted("https://mobile.twitter.com/biametronomo").normalizedKey).toBe(
      "x:biametronomo",
    );
    expect(expectAccepted("https://www.x.com/biametronomo").normalizedKey).toBe("x:biametronomo");
  });

  test("normalizes the same profile written several ways to one key", () => {
    const variants = [
      "https://instagram.com/rafaonda",
      "http://www.instagram.com/rafaonda/",
      "https://INSTAGRAM.com/RafaOnda?hl=pt-br",
      "instagram.com/rafaonda#reels",
    ];
    const keys = new Set(variants.map((variant) => expectAccepted(variant).normalizedKey));
    expect([...keys]).toEqual(["instagram:rafaonda"]);
  });
});

describe("platform canonical shapes", () => {
  test("Instagram", () => {
    const result = expectAccepted("https://instagram.com/rafaonda");
    expect(result.platform).toBe("INSTAGRAM");
    expect(result.handle).toBe("rafaonda");
    expect(result.normalizedKey).toBe("instagram:rafaonda");
    expect(result.canonicalUrl).toBe("https://instagram.com/rafaonda");
  });

  test("TikTok keeps the @ in the handle", () => {
    const result = expectAccepted("https://www.tiktok.com/@teobaiao");
    expect(result.platform).toBe("TIKTOK");
    expect(result.handle).toBe("@teobaiao");
    expect(result.normalizedKey).toBe("tiktok:@teobaiao");
    expect(result.canonicalUrl).toBe("https://tiktok.com/@teobaiao");
  });

  test("TikTok tolerates a missing @", () => {
    expect(expectAccepted("https://tiktok.com/teobaiao").normalizedKey).toBe("tiktok:@teobaiao");
  });

  test("YouTube handle", () => {
    const result = expectAccepted("https://youtube.com/@lunaverso");
    expect(result.platform).toBe("YOUTUBE");
    expect(result.normalizedKey).toBe("youtube:@lunaverso");
    expect(result.canonicalUrl).toBe("https://youtube.com/@lunaverso");
  });

  test("YouTube channel id", () => {
    const result = expectAccepted("https://www.youtube.com/channel/UC1234567890abcdefghijkl");
    expect(result.normalizedKey).toBe("youtube:channel-UC1234567890abcdefghijkl");
    expect(result.canonicalUrl).toBe("https://youtube.com/channel/UC1234567890abcdefghijkl");
  });

  test("YouTube video, playlist and search URLs are not creator profiles", () => {
    expectRejected("https://youtube.com/watch?v=abc123", "INVALID_PROFILE_URL");
    expectRejected("https://youtube.com/playlist?list=PL123", "INVALID_PROFILE_URL");
    expectRejected("https://youtube.com/results?search_query=luna", "INVALID_PROFILE_URL");
  });

  test("Twitch", () => {
    const result = expectAccepted("https://twitch.tv/ninareverb");
    expect(result.platform).toBe("TWITCH");
    expect(result.normalizedKey).toBe("twitch:ninareverb");
  });

  test("Spotify artist", () => {
    const result = expectAccepted("https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4");
    expect(result.platform).toBe("SPOTIFY");
    expect(result.handle).toBe("3TVXtAsR1Inumwj472S9r4");
    expect(result.normalizedKey).toBe("spotify:3TVXtAsR1Inumwj472S9r4");
    expect(result.canonicalUrl).toBe("https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4");
  });

  test("Spotify locale prefixes and tracking parameters are dropped", () => {
    expect(
      expectAccepted("https://open.spotify.com/intl-pt/artist/3TVXtAsR1Inumwj472S9r4?si=xyz")
        .normalizedKey,
    ).toBe("spotify:3TVXtAsR1Inumwj472S9r4");
  });

  test("a Spotify track or album is not a creator profile", () => {
    expectRejected("https://open.spotify.com/track/abc", "INVALID_PROFILE_URL");
    expectRejected("https://open.spotify.com/album/abc", "INVALID_PROFILE_URL");
  });

  test("Substack subdomain", () => {
    const result = expectAccepted("https://sabiaeletrico.substack.com/");
    expect(result.platform).toBe("SUBSTACK");
    expect(result.handle).toBe("sabiaeletrico");
    expect(result.normalizedKey).toBe("substack:sabiaeletrico");
    expect(result.canonicalUrl).toBe("https://sabiaeletrico.substack.com");
  });

  test("substack.com without a publication is not a creator profile", () => {
    expectRejected("https://substack.com", "INVALID_PROFILE_URL");
    expectRejected("https://www.substack.com/", "INVALID_PROFILE_URL");
  });

  test("a personal website collapses to its canonical origin", () => {
    const result = expectAccepted("https://www.exemplo.com.br/sobre?utm_source=x");
    expect(result.platform).toBe("WEBSITE");
    expect(result.handle).toBe("exemplo.com.br");
    expect(result.normalizedKey).toBe("site:exemplo.com.br");
    expect(result.canonicalUrl).toBe("https://exemplo.com.br");
  });

  test("a website on a non-default port keeps the port in its identity", () => {
    const result = expectAccepted("https://exemplo.com.br:8443/");
    expect(result.normalizedKey).toBe("site:exemplo.com.br:8443");
  });
});

describe("profile path validation", () => {
  test("rejects a supported platform without a profile path", () => {
    expectRejected("https://instagram.com", "INVALID_PROFILE_URL");
    expectRejected("https://instagram.com/", "INVALID_PROFILE_URL");
    expectRejected("https://twitch.tv/", "INVALID_PROFILE_URL");
  });

  test("rejects a platform's reserved paths", () => {
    for (const reserved of [
      "https://instagram.com/explore",
      "https://instagram.com/accounts/login",
      "https://x.com/home",
      "https://x.com/i/flow/login",
      "https://twitch.tv/directory",
    ]) {
      expectRejected(reserved, "INVALID_PROFILE_URL");
    }
  });

  test("rejects a handle with illegal characters or an absurd length", () => {
    expectRejected("https://instagram.com/lu na", "INVALID_PROFILE_URL");
    expectRejected(`https://instagram.com/${"a".repeat(200)}`, "INVALID_PROFILE_URL");
  });

  test("resolves plain path traversal the way a browser would", () => {
    // The URL parser collapses `/../etc` to `/etc` before we ever see it, which
    // is the safe outcome: the input genuinely points at instagram.com/etc.
    expect(expectAccepted("https://instagram.com/../etc").normalizedKey).toBe("instagram:etc");
  });

  test("collapses percent-encoded traversal per the URL specification", () => {
    // `%2e` is a dot segment to a conforming parser, so traversal never survives
    // into a stored path. The result is the profile the URL really points at.
    expect(expectAccepted("https://instagram.com/%2e%2e/%2e%2e/admin").normalizedKey).toBe(
      "instagram:admin",
    );
    expect(expectAccepted("https://exemplo.com.br/%2e%2e/etc/passwd").canonicalUrl).toBe(
      "https://exemplo.com.br",
    );
  });

  test("rejects an encoded separator or control character smuggled into a handle", () => {
    expectRejected("https://instagram.com/a%2Fb", "INVALID_PROFILE_URL");
    expectRejected("https://instagram.com/%00x", "INVALID_PROFILE_URL");
    expectRejected("https://instagram.com/luna%20verso", "INVALID_PROFILE_URL");
  });

  test("keeps a deep profile path out of the identity", () => {
    // A post URL still identifies the creator who owns the profile segment.
    const result = expectAccepted("https://instagram.com/rafaonda/p/CxYz123/");
    expect(result.normalizedKey).toBe("instagram:rafaonda");
    expect(result.canonicalUrl).toBe("https://instagram.com/rafaonda");
  });
});

describe("idempotence", () => {
  test("normalizing a canonical URL again changes nothing", () => {
    for (const input of [
      "https://instagram.com/rafaonda",
      "https://tiktok.com/@teobaiao",
      "https://youtube.com/@lunaverso",
      "https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4",
      "https://sabiaeletrico.substack.com",
      "https://exemplo.com.br",
    ]) {
      const once = expectAccepted(input);
      const twice = expectAccepted(once.canonicalUrl);
      expect(twice).toEqual(once);
    }
  });
});
