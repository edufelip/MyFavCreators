import { ImageResponse } from "next/og";
import { fetchCreatorDetail } from "@/lib/api";
import { copy } from "@/lib/copy";
import { formatBrl, formatHandle, initialsOf } from "@/lib/format";
import { STORY_SIZE, StoryCard } from "@/lib/og";

export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = STORY_SIZE;

/**
 * The creator 9:16 vertical story card for Instagram Stories and TikTok.
 *
 * Only an APPROVED creator has one.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const creator = await fetchCreatorDetail(slug);
  if (creator === null) {
    return new Response("Not found", { status: 404 });
  }

  const primary = creator.links.find((link) => link.isPrimary) ?? creator.links[0];

  return new ImageResponse(
    StoryCard({
      eyebrow:
        creator.weekly.rank === null ? copy.rotation.title : `#${creator.weekly.rank} no ranking`,
      title: creator.displayName,
      subtitle: primary === undefined ? null : formatHandle(primary.handle, primary.platform),
      amount: formatBrl(creator.weekly.amountCents),
      amountLabel: copy.leaderboard.amountSuffix.weekly,
      footer: copy.hero.headline,
      initials: initialsOf(creator.displayName),
    }),
    size,
  );
}
