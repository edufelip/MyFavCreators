"use client";

import { useEffect, useState } from "react";
import { copy } from "@/lib/copy";
import { formatDuration } from "@/lib/format";

export type CountdownProps = {
  /** UTC instant the current weekly period closes. */
  readonly endsAt: string;
  /** Rendered on the server so the first client paint matches exactly. */
  readonly initialLabel: string;
};

/**
 * The weekly reset countdown.
 *
 * The period boundary is decided by the server; this only renders the distance
 * to it, so a wrong clock on a visitor's device can never change a ranking.
 */
export function Countdown({ endsAt, initialLabel }: CountdownProps) {
  const [label, setLabel] = useState(initialLabel);

  useEffect(() => {
    const deadline = new Date(endsAt).getTime();
    const tick = () => {
      setLabel(formatDuration(deadline - Date.now()));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [endsAt]);

  return (
    <p className="text-xs font-medium text-white/60 sm:text-sm" data-testid="countdown">
      {copy.countdown.label(label)}
    </p>
  );
}
