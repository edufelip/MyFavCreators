"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export type LiveRefreshProps = {
  readonly intervalMs?: number;
  /** Interval used while the tab is in the background. */
  readonly hiddenIntervalMs?: number;
};

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_HIDDEN_INTERVAL_MS = 120_000;

/**
 * Keeps the ranking fresh without a reload.
 *
 * `router.refresh()` re-runs the server render, so the billboard, the rotation,
 * the leaderboard and the ticker all update from one round trip and the page has
 * exactly one rendering path. Fetching the leaderboard separately on the client
 * would mean maintaining a second copy of that rendering, and the initial render
 * has to stay server-side HTML for the ranking to be indexable.
 *
 * Near-real-time is enough here, so this is polling rather than a socket. A tab
 * in someone's pocket drops to a slow heartbeat and refreshes at once when they
 * come back, because a phone should not hammer the API to watch a number that
 * changes every few minutes.
 */
export function LiveRefresh({
  intervalMs = DEFAULT_INTERVAL_MS,
  hiddenIntervalMs = DEFAULT_HIDDEN_INTERVAL_MS,
}: LiveRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      timer = setTimeout(
        () => {
          router.refresh();
          schedule();
        },
        document.hidden ? hiddenIntervalMs : intervalMs,
      );
    };

    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (!document.hidden) {
        router.refresh();
      }
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, intervalMs, hiddenIntervalMs]);

  return null;
}
