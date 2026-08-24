import { ImageResponse } from "next/og";
import { fetchLeaderboard } from "@/lib/api";
import { copy } from "@/lib/copy";
import { formatBrl, initialsOf } from "@/lib/format";
import { OG_SIZE, OgCard } from "@/lib/og";

export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = OG_SIZE;

/** The homepage share card: whoever holds the billboard right now. */
export async function GET(): Promise<Response> {
  let leaderName: string = copy.brand.name;
  let amount = "";

  try {
    const weekly = await fetchLeaderboard({ tab: "weekly", limit: 1 });
    if (weekly.leader !== null) {
      leaderName = weekly.leader.creator.displayName;
      amount = formatBrl(weekly.leader.amountCents);
    }
  } catch {
    // A share card must never fail the way a page would; the generic card is
    // still a correct representation of the product.
  }

  return new ImageResponse(
    OgCard({
      eyebrow: copy.billboard.eyebrow,
      title: leaderName,
      subtitle: copy.hero.subheadline,
      amount: amount === "" ? copy.hero.headline : amount,
      amountLabel: amount === "" ? "" : copy.leaderboard.amountSuffix.weekly,
      footer: copy.brand.name,
      initials: initialsOf(leaderName),
    }),
    size,
  );
}
