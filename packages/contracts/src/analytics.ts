import { type Static, Type as t } from "@sinclair/typebox";
import { IsoDateTime, Slug, Uuid } from "./primitives";

/**
 * Where a creator was displayed. Mirrors the domain's `DELIVERY_SURFACES`; a
 * parity test keeps the two from drifting.
 */
export const DeliverySurfaceSchema = t.Union([
  t.Literal("MARQUEE"),
  t.Literal("LEADERBOARD"),
  t.Literal("ROTATION"),
  t.Literal("CREATOR_PAGE"),
  t.Literal("EMBED"),
]);
export type DeliverySurfaceSchema = Static<typeof DeliverySurfaceSchema>;

export const ImpressionEntryDto = t.Object(
  { creatorId: Uuid, surface: DeliverySurfaceSchema },
  { $id: "ImpressionEntry" },
);
export type ImpressionEntryDto = Static<typeof ImpressionEntryDto>;

/**
 * A page reporting what it displayed.
 *
 * The session identifier is deliberately absent: it is an httpOnly cookie read
 * by the web server and forwarded from there, never something a browser script
 * or a caller can choose. A client that could name its own session could mint
 * unlimited impressions simply by inventing new ones.
 */
export const ImpressionBatchRequestDto = t.Object(
  { entries: t.Array(ImpressionEntryDto, { minItems: 1, maxItems: 120 }) },
  { $id: "ImpressionBatchRequest" },
);
export type ImpressionBatchRequestDto = Static<typeof ImpressionBatchRequestDto>;

export const ImpressionBatchResponseDto = t.Object(
  { recorded: t.Integer({ minimum: 0 }) },
  { $id: "ImpressionBatchResponse" },
);
export type ImpressionBatchResponseDto = Static<typeof ImpressionBatchResponseDto>;

export const OutboundClickRequestDto = t.Object(
  { creatorLinkId: Uuid, referrer: t.Optional(t.Union([t.String({ maxLength: 512 }), t.Null()])) },
  { $id: "OutboundClickRequest" },
);
export type OutboundClickRequestDto = Static<typeof OutboundClickRequestDto>;

/** The validated destination for a tracked redirect. Never a caller-supplied URL. */
export const OutboundClickResponseDto = t.Object(
  { url: t.String({ maxLength: 2048 }), creatorSlug: Slug, counted: t.Boolean() },
  { $id: "OutboundClickResponse" },
);
export type OutboundClickResponseDto = Static<typeof OutboundClickResponseDto>;

export const DeliveryReportDto = t.Object(
  {
    creatorSlug: Slug,
    window: t.Union([t.Literal("weekly"), t.Literal("all-time")]),
    periodStartsAt: t.Union([IsoDateTime, t.Null()]),
    periodEndsAt: t.Union([IsoDateTime, t.Null()]),
    impressions: t.Integer({ minimum: 0 }),
    outboundClicks: t.Integer({ minimum: 0 }),
    /**
     * Clicks per impression, or null when nothing was shown. A delivery report
     * states what was measured and never promises audience behaviour.
     */
    clickThroughRate: t.Union([t.Number({ minimum: 0, maximum: 1 }), t.Null()]),
    bySurface: t.Array(
      t.Object({ surface: DeliverySurfaceSchema, impressions: t.Integer({ minimum: 0 }) }),
    ),
  },
  { $id: "DeliveryReport" },
);
export type DeliveryReportDto = Static<typeof DeliveryReportDto>;
