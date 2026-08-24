"use client";

import { useEffect, useRef } from "react";

export type DeliverySurfaceName = "MARQUEE" | "LEADERBOARD" | "ROTATION" | "CREATOR_PAGE" | "EMBED";

export type ImpressionReporterProps = {
  readonly entries: ReadonlyArray<{
    readonly creatorId: string;
    readonly surface: DeliverySurfaceName;
  }>;
};

/**
 * Reports what this page actually put in front of somebody.
 *
 * Sent once the page is visible, not on render: a tab opened in the background
 * or a prefetch has displayed nothing, and counting it would make a delivery
 * report claim visibility nobody got.
 *
 * The beacon carries no identity. The session id is added by the server from an
 * httpOnly cookie, so a page cannot invent sessions, and the endpoint answers
 * 204 whatever happens — measurement is never worth telling a page about, and a
 * varying answer would let a caller probe which creators exist.
 *
 * Impressions are not a ranking input. Nothing this component sends can move a
 * position; money is the only ranking signal.
 */
export function ImpressionReporter({ entries }: ImpressionReporterProps) {
  /**
   * The payload already sent, so a re-render with the same entries is not a
   * second report and a genuinely changed page is.
   */
  const sent = useRef<string | null>(null);
  const payload = JSON.stringify(entries);

  useEffect(() => {
    if (entries.length === 0) {
      return;
    }

    const send = () => {
      if (sent.current === payload || document.hidden) {
        return;
      }
      sent.current = payload;
      void fetch("/api/impressions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {
        // A delivery report may under-count. It may never block a page.
      });
    };

    send();
    document.addEventListener("visibilitychange", send);
    return () => {
      document.removeEventListener("visibilitychange", send);
    };
  }, [payload, entries.length]);

  return null;
}
