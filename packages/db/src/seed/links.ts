import type { CreatorPlatform } from "@creator-outdoor/domain";
import { deterministicUuid } from "./deterministic";

export type CreatorLinkDescriptor = {
  readonly url: string;
  readonly handle: string;
  readonly normalizedKey: string;
};

function spotifyArtistId(handle: string): string {
  return deterministicUuid(`spotify:${handle}`).replace(/-/g, "").slice(0, 22);
}

/**
 * Builds the canonical URL, handle and deduplication key for a seeded link.
 *
 * Phase 2 replaces this with real submission-time URL normalization; the shapes
 * produced here are the same ones that normalization must yield.
 */
export function describeCreatorLink(
  platform: CreatorPlatform,
  handle: string,
): CreatorLinkDescriptor {
  switch (platform) {
    case "INSTAGRAM":
      return {
        url: `https://instagram.com/${handle}`,
        handle,
        normalizedKey: `instagram:${handle}`,
      };
    case "TIKTOK":
      return {
        url: `https://tiktok.com/@${handle}`,
        handle: `@${handle}`,
        normalizedKey: `tiktok:@${handle}`,
      };
    case "YOUTUBE":
      return {
        url: `https://youtube.com/@${handle}`,
        handle: `@${handle}`,
        normalizedKey: `youtube:@${handle}`,
      };
    case "TWITCH":
      return { url: `https://twitch.tv/${handle}`, handle, normalizedKey: `twitch:${handle}` };
    case "X":
      return { url: `https://x.com/${handle}`, handle, normalizedKey: `x:${handle}` };
    case "SPOTIFY": {
      const artistId = spotifyArtistId(handle);
      return {
        url: `https://open.spotify.com/artist/${artistId}`,
        handle,
        normalizedKey: `spotify:${artistId}`,
      };
    }
    case "SUBSTACK":
      return {
        url: `https://${handle}.substack.com`,
        handle,
        normalizedKey: `substack:${handle}`,
      };
    case "WEBSITE":
      return {
        url: `https://${handle}.com.br`,
        handle,
        normalizedKey: `site:${handle}.com.br`,
      };
  }
}
