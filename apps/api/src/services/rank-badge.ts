import type { ProductConfig } from "@creator-outdoor/config";
import {
  type Database,
  findCreatorBySlug,
  getCreatorStanding,
  recordImpressions,
} from "@creator-outdoor/db";
import {
  centsValue,
  getWeeklyPeriod,
  hourBucket,
  isPubliclyEligible,
} from "@creator-outdoor/domain";
import { log } from "../observability/logger";

export type RankBadge = {
  readonly svg: string;
  readonly creatorSlug: string;
};

const WIDTH = 320;
const HEIGHT = 80;

/**
 * The embeddable rank badge.
 *
 * An SVG rather than an iframe or a script: it works in a README, a link-in-bio
 * page and an email signature, it runs no code on somebody else's site, and it
 * can carry no cookie. Anything a creator embeds on their own page is a promise
 * about what Creator Outdoor puts on other people's pages, and the smallest
 * possible promise is a picture.
 *
 * Counted as an EMBED impression when a session is known, and rendered either
 * way: a badge that failed to render because measurement failed would be a
 * broken image on somebody's profile.
 */
export async function renderRankBadge(
  database: Database,
  product: ProductConfig,
  input: { readonly slug: string; readonly sessionId: string | null; readonly now: Date },
): Promise<RankBadge | null> {
  const creator = await findCreatorBySlug(database, input.slug);
  if (creator === null || !isPubliclyEligible(creator.moderationStatus)) {
    return null;
  }

  const period = getWeeklyPeriod(input.now, product.timezone);
  const standing = await getCreatorStanding(database, creator.id, {
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  });

  if (input.sessionId !== null) {
    try {
      await recordImpressions(database, {
        sessionId: input.sessionId,
        hourBucket: hourBucket(input.now),
        entries: [{ creatorId: creator.id, surface: "EMBED" }],
      });
    } catch (error) {
      log.error("embed_impression_failed", error);
    }
  }

  return {
    creatorSlug: creator.slug,
    svg: badgeSvg({
      displayName: creator.displayName,
      rank: standing.rank,
      amountCents: centsValue(standing.amountCents),
    }),
  };
}

/**
 * Escapes text for an SVG document.
 *
 * A display name comes from a submitted profile, and this string is served to
 * other people's websites. Everything that could close a tag or open an entity
 * is replaced before it reaches the markup.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Money at the presentation edge, from integer centavos. */
function formatAmount(cents: number): string {
  const reais = Math.trunc(cents / 100);
  const centavos = cents % 100;
  const whole = reais.toLocaleString("pt-BR");
  return centavos === 0 ? `R$${whole}` : `R$${whole},${String(centavos).padStart(2, "0")}`;
}

function badgeSvg(input: {
  readonly displayName: string;
  readonly rank: number | null;
  readonly amountCents: number;
}): string {
  const name = escapeXml(truncate(input.displayName, 22));
  const position = input.rank === null ? "sem impulsos" : `#${input.rank} desta semana`;
  const amount = formatAmount(input.amountCents);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${name} ${escapeXml(position)}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" rx="12" fill="#0a0a0a"/>`,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="11.5" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>`,
    '<text x="16" y="26" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="11" font-weight="700" letter-spacing="2" fill="#fcd34d">CREATOR OUTDOOR</text>',
    `<text x="16" y="48" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="16" font-weight="800" fill="#ffffff">${name}</text>`,
    `<text x="16" y="66" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="12" fill="#ffffff" fill-opacity="0.65">${escapeXml(position)} · ${escapeXml(amount)}</text>`,
    "</svg>",
  ].join("");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
