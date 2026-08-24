import { createHash } from "node:crypto";

/** Fixed namespace so a re-run produces byte-identical fixture identifiers. */
const SEED_NAMESPACE = "d5b1f6c2-6c4e-5f0a-9a3e-4f2b7c1d8e90";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/**
 * RFC 4122 version 5 (SHA-1, name-based) UUID.
 *
 * Seed rows carry stable identifiers, so re-running the seed replaces the same
 * rows instead of accumulating duplicates, and fixtures can be referenced by
 * name across scripts and tests.
 */
export function deterministicUuid(name: string): string {
  const hash = createHash("sha1")
    .update(uuidToBytes(SEED_NAMESPACE))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Digest is shorter than 16 bytes");
  }
  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * A small deterministic pseudo-random generator (mulberry32).
 *
 * Fixture data must be varied enough to look real and identical on every run,
 * so `Math.random` is never used here.
 */
export class DeterministicRandom {
  private state: number;

  constructor(seed: string) {
    const digest = createHash("sha1").update(seed).digest();
    this.state = digest.readUInt32BE(0);
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in `[0, exclusiveMax)`. */
  int(exclusiveMax: number): number {
    return Math.floor(this.next() * exclusiveMax);
  }

  pick<TItem>(items: readonly TItem[]): TItem {
    const item = items[this.int(items.length)];
    if (item === undefined) {
      throw new Error("Cannot pick from an empty list");
    }
    return item;
  }
}

/**
 * Splits a total into individual boost amounts.
 *
 * Every part is a realistic quick value or a remainder that still clears the
 * minimum boost, and the parts always sum to exactly the total.
 */
export function splitIntoBoostAmounts(
  totalCents: number,
  random: DeterministicRandom,
  minBoostCents: number,
): number[] {
  const quickValues = [500, 1000, 2500, 5000, 10000];
  const parts: number[] = [];
  let remaining = totalCents;
  while (remaining > 0) {
    const candidates = quickValues.filter(
      (value) =>
        value <= remaining && (remaining - value === 0 || remaining - value >= minBoostCents),
    );
    if (candidates.length === 0) {
      parts.push(remaining);
      break;
    }
    const value = random.pick(candidates);
    parts.push(value);
    remaining -= value;
  }
  return parts;
}
