/**
 * Host safety checks.
 *
 * A creator URL is attacker-supplied and later becomes an outbound link and,
 * potentially, a metadata fetch target. Anything that resolves inside the
 * infrastructure — loopback, private ranges, link-local (including the cloud
 * metadata address), reserved ranges and bare internal hostnames — is refused
 * before it can be stored.
 */

const INTERNAL_HOSTNAMES = new Set(["localhost", "host", "broadcasthost"]);
const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa"];

function isIpv4Octets(parts: readonly number[]): boolean {
  return (
    parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  );
}

/**
 * Parses the IPv4 forms a URL parser accepts, including the shorthand and
 * numeric encodings used to smuggle `127.0.0.1` past naive string checks.
 */
export function parseIpv4(host: string): number[] | null {
  const rawParts = host.split(".");
  if (rawParts.length > 4 || rawParts.some((part) => part === "")) {
    return null;
  }

  const numbers: number[] = [];
  for (const part of rawParts) {
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
      value = Number.parseInt(part.slice(2), 16);
    } else if (/^0[0-7]+$/.test(part)) {
      value = Number.parseInt(part.slice(1), 8);
    } else if (/^(?:0|[1-9]\d*)$/.test(part)) {
      // A leading zero means octal, so "0178" is not decimal 178 — it is not a
      // valid address at all. Reading it as decimal is how "010.0.0.1" becomes
      // 8.0.0.1 here and 10.0.0.1 in whatever resolves it later.
      value = Number.parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    numbers.push(value);
  }

  const last = numbers[numbers.length - 1];
  if (last === undefined) {
    return null;
  }
  // `a.b.c` means a.b.0.c, `a.b` means a.0.0.b, `a` means the whole 32-bit value.
  const leading = numbers.slice(0, -1);
  const remainingOctets = 4 - leading.length;
  if (last >= 256 ** remainingOctets) {
    return null;
  }
  const tail: number[] = [];
  for (let index = remainingOctets - 1; index >= 0; index -= 1) {
    tail.push((last >>> (index * 8)) & 0xff);
  }
  const octets = [...leading, ...tail];
  return isIpv4Octets(octets) ? octets : null;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, including 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const address = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (address === "::1" || address === "::" || address === "0:0:0:0:0:0:0:1") {
    return true;
  }
  // Unique local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address)) {
    return true;
  }
  // IPv4-mapped addresses inherit the IPv4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1] !== undefined) {
    const octets = parseIpv4(mapped[1]);
    return octets !== null && isPrivateIpv4(octets);
  }
  return false;
}

/**
 * A host written entirely as a number, in any base a URL parser might accept.
 *
 * Detected separately from parsing it, because the dangerous case is exactly
 * the one that does *not* parse cleanly: parsers disagree about zero-padded and
 * malformed numeric hosts, and a host this code cannot pin down is a host that
 * might resolve somewhere private.
 */
function looksNumeric(host: string): boolean {
  return /^[0-9a-fx.]+$/i.test(host) && /^\d/.test(host);
}

/** True when any label is zero-padded, which parsers read as octal or decimal. */
function hasAmbiguousLabel(host: string): boolean {
  return host.split(".").some((label) => label.length > 1 && label.startsWith("0"));
}

/** True when the host must never be stored, linked to, or fetched. */
export function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === "") {
    return true;
  }
  if (host.startsWith("[")) {
    return isPrivateIpv6(host);
  }
  if (INTERNAL_HOSTNAMES.has(host)) {
    return true;
  }
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }

  if (looksNumeric(host)) {
    /*
     * A numeric host is refused unless it parses to a definitely public
     * address. Zero padding is refused outright: "010.0.0.1" is octal 8 to one
     * parser and decimal 10 — a private address — to another, and a check that
     * has to guess which reader comes next is not a check.
     */
    if (hasAmbiguousLabel(host)) {
      return true;
    }
    const octets = parseIpv4(host);
    return octets === null || isPrivateIpv4(octets);
  }

  // A bare label with no dot is an intranet name, never a public site.
  return !host.includes(".");
}
