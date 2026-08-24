import {
  type CreatorPlatform,
  creatorPlatformLabel,
  type NormalizedCreatorUrl,
} from "@creator-outdoor/domain";

export type CreatorMetadata = {
  readonly displayName: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
};

/**
 * Where creator metadata comes from.
 *
 * Deliberately narrow. Creator Outdoor prefers official public APIs, official
 * oEmbed, or information an administrator fills in during moderation. It does
 * not build brittle scrapers, bypass platform protections, or drive an
 * unsupported browser, so an implementation that cannot obtain metadata safely
 * returns what it can and leaves the rest to moderation.
 */
export interface CreatorMetadataProvider {
  readonly name: string;
  fetchMetadata(url: NormalizedCreatorUrl): Promise<CreatorMetadata>;
}

function titleCaseHandle(handle: string, platform: CreatorPlatform): string {
  if (platform === "WEBSITE") {
    return handle;
  }
  const bare = handle.replace(/^@/, "");
  const words = bare
    .split(/[._-]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length === 0 ? bare : words.join(" ");
}

/**
 * The default provider: everything derivable from the URL itself, with no
 * network call at all. An administrator completes the rest during moderation,
 * which is exactly the fallback the product specifies when metadata cannot be
 * retrieved safely.
 */
export function deriveMetadataFromUrl(url: NormalizedCreatorUrl): CreatorMetadata {
  return {
    displayName: titleCaseHandle(url.handle, url.platform),
    bio: null,
    avatarUrl: null,
  };
}

export const urlDerivedMetadataProvider: CreatorMetadataProvider = {
  name: "url-derived",
  fetchMetadata: (url) => Promise.resolve(deriveMetadataFromUrl(url)),
};

export function describeMetadataSource(url: NormalizedCreatorUrl): string {
  return `${creatorPlatformLabel(url.platform)} · ${url.handle}`;
}
