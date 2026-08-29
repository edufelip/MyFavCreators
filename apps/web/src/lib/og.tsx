import type { ReactElement } from "react";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const STORY_SIZE = { width: 1080, height: 1920 } as const;
export const OG_CONTENT_TYPE = "image/png";

const BACKGROUND = "#0a0a0a";
const ACCENT = "#fbbf24";

export type OgCardProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly amount: string;
  readonly amountLabel: string;
  readonly footer: string;
  readonly initials: string;
};

/**
 * The share card.
 *
 * It carries only what is already public on the page it represents: a creator,
 * a position and a public amount. No supporter name, no message, no email, no
 * identifier — a share card is the most widely copied surface the product has,
 * and nothing private may ride along.
 */
export function OgCard(props: OgCardProps): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: `linear-gradient(135deg, ${BACKGROUND} 0%, #1c1917 55%, #292524 100%)`,
        color: "#fafafa",
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 26,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: ACCENT,
            fontWeight: 800,
          }}
        >
          {props.eyebrow}
        </span>
        <span style={{ fontSize: 24, color: "#a8a29e", letterSpacing: 3 }}>CREATOR OUTDOOR</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
        <div
          style={{
            width: 180,
            height: 180,
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            border: "4px solid rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 68,
            fontWeight: 800,
            color: "#e7e5e4",
          }}
        >
          {props.initials}
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 820 }}>
          <span style={{ fontSize: 76, fontWeight: 900, lineHeight: 1.05 }}>{props.title}</span>
          {props.subtitle === null ? null : (
            <span style={{ fontSize: 34, color: "#a8a29e", marginTop: 8 }}>{props.subtitle}</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 84, fontWeight: 900, color: ACCENT, lineHeight: 1 }}>
            {props.amount}
          </span>
          <span style={{ fontSize: 28, color: "#a8a29e", marginTop: 10 }}>{props.amountLabel}</span>
        </div>
        <span style={{ fontSize: 30, color: "#d6d3d1" }}>{props.footer}</span>
      </div>
    </div>
  );
}

/**
 * The vertical 9:16 story share card for Instagram Stories, TikTok, and WhatsApp Status.
 */
export function StoryCard(props: OgCardProps): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "center",
        textAlign: "center",
        background: `radial-gradient(circle at 50% 20%, #292524 0%, #1c1917 40%, ${BACKGROUND} 100%)`,
        color: "#fafafa",
        padding: 100,
        fontFamily: "sans-serif",
      }}
    >
      {/* Top Header & Eyebrow */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <span
          style={{
            fontSize: 32,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: "#a8a29e",
            fontWeight: 700,
          }}
        >
          CREATOR OUTDOOR
        </span>
        <div
          style={{
            background: "rgba(251, 191, 36, 0.15)",
            border: "2px solid rgba(251, 191, 36, 0.4)",
            borderRadius: 999,
            padding: "16px 36px",
            marginTop: 12,
          }}
        >
          <span
            style={{
              fontSize: 38,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: ACCENT,
              fontWeight: 900,
            }}
          >
            {props.eyebrow}
          </span>
        </div>
      </div>

      {/* Center Avatar & Creator Info */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 32,
          margin: "40px 0",
        }}
      >
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
            border: "8px solid rgba(251, 191, 36, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 120,
            fontWeight: 900,
            color: "#fafafa",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          {props.initials}
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 880 }}
        >
          <span style={{ fontSize: 88, fontWeight: 900, lineHeight: 1.1 }}>{props.title}</span>
          {props.subtitle === null ? null : (
            <span style={{ fontSize: 44, color: "#a8a29e", marginTop: 16 }}>{props.subtitle}</span>
          )}
        </div>
      </div>

      {/* Bottom Amount & Call to Action */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          background: "rgba(255,255,255,0.04)",
          border: "2px solid rgba(255,255,255,0.1)",
          borderRadius: 36,
          padding: "48px 64px",
          width: "100%",
        }}
      >
        <span style={{ fontSize: 104, fontWeight: 900, color: ACCENT, lineHeight: 1 }}>
          {props.amount}
        </span>
        <span style={{ fontSize: 36, color: "#d6d3d1", fontWeight: 600 }}>{props.amountLabel}</span>
        <span style={{ fontSize: 32, color: "#a8a29e", marginTop: 12 }}>{props.footer}</span>
      </div>
    </div>
  );
}
