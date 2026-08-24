const INTEGER_FORMATTER = new Intl.NumberFormat("pt-BR");

/**
 * Renders integer centavos as BRL.
 *
 * Formatting is the only place a monetary value stops being an integer, and
 * whole amounts drop the centavos so the copy reads `R$95`, not `R$ 95,00`.
 */
export function formatBrl(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Expected non-negative integer centavos, received: ${cents}`);
  }
  const reais = INTEGER_FORMATTER.format(Math.floor(cents / 100));
  const centavos = cents % 100;
  return centavos === 0 ? `R$${reais}` : `R$${reais},${String(centavos).padStart(2, "0")}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `3d 08h 12m 45s`, dropping leading units that are zero. */
export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, milliseconds);
  const days = Math.floor(total / DAY_MS);
  const hours = Math.floor((total % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((total % MINUTE_MS) / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");

  if (days > 0) {
    return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  }
  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

/** Two initials for a creator with no avatar. */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? "?";
  const second = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

/**
 * Renders a creator handle for display.
 *
 * Platform handles are stored as the platform writes them; the public surface
 * shows the familiar `@handle` form except for a website, which has none.
 */
export function formatHandle(handle: string, platform: string | null): string {
  if (platform === "WEBSITE") {
    return handle;
  }
  return handle.startsWith("@") ? handle : `@${handle}`;
}

/**
 * A short pt-BR "how long ago" for the ticker.
 *
 * Rounded down deliberately: "há 2 min" for anything under three minutes reads
 * as fresher than it is, and the ticker's job is to feel live and be honest.
 */
export function formatRelativeTime(instant: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - instant.getTime());
  const minutes = Math.floor(elapsed / MINUTE_MS);
  if (minutes < 1) {
    return "instantes";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(elapsed / HOUR_MS);
  if (hours < 24) {
    return `${hours} h`;
  }
  return `${Math.floor(elapsed / DAY_MS)} d`;
}
