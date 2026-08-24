import { initialsOf } from "@/lib/format";

export type CreatorAvatarProps = {
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly size: "sm" | "lg";
};

const SIZE_CLASSES = {
  sm: "h-12 w-12 text-base",
  lg: "h-24 w-24 text-3xl sm:h-28 sm:w-28",
} as const;

export function CreatorAvatar({ displayName, avatarUrl, size }: CreatorAvatarProps) {
  const classes = `${SIZE_CLASSES[size]} shrink-0 overflow-hidden rounded-full border border-white/15 bg-white/10 object-cover`;

  if (avatarUrl !== null) {
    // Avatars come from creator platforms; Next's optimizer is not configured
    // for arbitrary remote hosts, so this stays a plain image element.
    // biome-ignore lint/performance/noImgElement: remote avatar hosts are not allowlisted for next/image
    return <img src={avatarUrl} alt="" aria-hidden="true" className={classes} />;
  }

  return (
    <span
      aria-hidden="true"
      className={`${classes} flex items-center justify-center font-semibold tracking-tight text-white/70`}
    >
      {initialsOf(displayName)}
    </span>
  );
}
