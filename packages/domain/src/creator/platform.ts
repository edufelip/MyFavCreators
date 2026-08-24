/** The link platforms Creator Outdoor supports in V1. */
export const CREATOR_PLATFORMS = [
  "INSTAGRAM",
  "TIKTOK",
  "YOUTUBE",
  "TWITCH",
  "X",
  "SPOTIFY",
  "SUBSTACK",
  "WEBSITE",
] as const;
export type CreatorPlatform = (typeof CREATOR_PLATFORMS)[number];

export function isCreatorPlatform(value: unknown): value is CreatorPlatform {
  return typeof value === "string" && (CREATOR_PLATFORMS as readonly string[]).includes(value);
}

const PLATFORM_LABELS: Readonly<Record<CreatorPlatform, string>> = {
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  TWITCH: "Twitch",
  X: "X",
  SPOTIFY: "Spotify",
  SUBSTACK: "Substack",
  WEBSITE: "Site",
};

export function creatorPlatformLabel(platform: CreatorPlatform): string {
  return PLATFORM_LABELS[platform];
}
