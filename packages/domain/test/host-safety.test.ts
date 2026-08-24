import { describe, expect, test } from "bun:test";
import { isUnsafeHost, parseIpv4 } from "../src";

/**
 * The host check decides whether a submitted URL may be stored, linked to and
 * later fetched. Everything here is an address somebody would use to reach
 * infrastructure that is not theirs, written the way a URL parser accepts it.
 *
 * Written against mutation testing rather than line coverage: each case exists
 * because removing the rule it covers has to fail something.
 */

describe("parsing the IPv4 forms a URL parser accepts", () => {
  test("reads plain dotted quads", () => {
    expect(parseIpv4("192.168.0.1")).toEqual([192, 168, 0, 1]);
    expect(parseIpv4("8.8.8.8")).toEqual([8, 8, 8, 8]);
    expect(parseIpv4("0.0.0.0")).toEqual([0, 0, 0, 0]);
    expect(parseIpv4("255.255.255.255")).toEqual([255, 255, 255, 255]);
  });

  test("expands the shorthand forms", () => {
    // These are the encodings used to smuggle a loopback address past a check
    // that only looks for the string "127.0.0.1".
    expect(parseIpv4("127.1")).toEqual([127, 0, 0, 1]);
    expect(parseIpv4("127.0.1")).toEqual([127, 0, 0, 1]);
    expect(parseIpv4("2130706433")).toEqual([127, 0, 0, 1]);
    expect(parseIpv4("192.11010049")).toEqual([192, 168, 0, 1]);
  });

  test("reads hexadecimal octets", () => {
    expect(parseIpv4("0x7f.0x0.0x0.0x1")).toEqual([127, 0, 0, 1]);
    expect(parseIpv4("0X7F000001")).toEqual([127, 0, 0, 1]);
  });

  test("reads octal octets", () => {
    expect(parseIpv4("0177.0.0.01")).toEqual([127, 0, 0, 1]);
    expect(parseIpv4("017700000001")).toEqual([127, 0, 0, 1]);
  });

  test("refuses an octal octet with a digit outside base 8", () => {
    expect(parseIpv4("0900.0.0.1")).toBeNull();
  });

  test("refuses hexadecimal that is not hexadecimal", () => {
    expect(parseIpv4("0xzz.0.0.1")).toBeNull();
    expect(parseIpv4("0x.0.0.1")).toBeNull();
  });

  test("refuses an octet that only starts as a number", () => {
    // `parseInt` stops at the first character it cannot read, so a check that
    // did not anchor at the end would read "0x7fzz" as 127 — trailing rubbish
    // silently becoming a loopback address.
    expect(parseIpv4("0x7fzz.0.0.1")).toBeNull();
    expect(parseIpv4("12abc.0.0.1")).toBeNull();
    expect(parseIpv4("0x7f 00.0.0.1")).toBeNull();
  });

  test("refuses a zero-padded decimal, which is not decimal", () => {
    // "0178" is not 178: the leading zero means octal, and 8 is not an octal
    // digit, so the address is invalid rather than being read in another base.
    expect(parseIpv4("0178.0.0.1")).toBeNull();
    expect(parseIpv4("09.0.0.1")).toBeNull();
    // "00" is octal zero, which is well defined; the host check refuses it
    // anyway, because 0.x.x.x is "this network".
    expect(parseIpv4("00.0.0.1")).toEqual([0, 0, 0, 1]);
  });

  test("refuses more than four parts", () => {
    expect(parseIpv4("1.2.3.4.5")).toBeNull();
  });

  test("refuses an empty part, however it appears", () => {
    expect(parseIpv4("1..2.3")).toBeNull();
    expect(parseIpv4(".1.2.3")).toBeNull();
    expect(parseIpv4("1.2.3.")).toBeNull();
    expect(parseIpv4("")).toBeNull();
  });

  test("refuses a part that is not a number at all", () => {
    expect(parseIpv4("example.com")).toBeNull();
    expect(parseIpv4("1.2.3.four")).toBeNull();
    expect(parseIpv4("-1.2.3.4")).toBeNull();
    expect(parseIpv4("1.2.3.4a")).toBeNull();
  });

  test("refuses a final part too large for the octets it has to fill", () => {
    // `a.b.c` fills one octet, `a.b` fills two, `a` fills four.
    expect(parseIpv4("1.2.3.256")).toBeNull();
    expect(parseIpv4("1.2.65536")).toBeNull();
    expect(parseIpv4("1.16777216")).toBeNull();
    expect(parseIpv4("4294967296")).toBeNull();
  });

  test("accepts the largest value each form allows", () => {
    expect(parseIpv4("1.2.3.255")).toEqual([1, 2, 3, 255]);
    expect(parseIpv4("1.2.65535")).toEqual([1, 2, 255, 255]);
    expect(parseIpv4("1.16777215")).toEqual([1, 255, 255, 255]);
    expect(parseIpv4("4294967295")).toEqual([255, 255, 255, 255]);
  });

  test("refuses a leading octet above 255 even when the last one fits", () => {
    expect(parseIpv4("256.1.1.1")).toBeNull();
    expect(parseIpv4("999.168.0.1")).toBeNull();
  });

  test("places shorthand bytes in the right order", () => {
    // 1.2.3 is 1.2.0.3, not 1.2.3.0 — a swap here would make a private range
    // look public.
    expect(parseIpv4("10.1.2")).toEqual([10, 1, 0, 2]);
    expect(parseIpv4("10.66051")).toEqual([10, 1, 2, 3]);
  });
});

describe("addresses that must never be stored", () => {
  const unsafe = [
    "localhost",
    "LOCALHOST",
    "host",
    "broadcasthost",
    "app.localhost",
    "db.local",
    "service.internal",
    "wiki.intranet",
    "printer.lan",
    "thing.home.arpa",
    "intranet",
    "router",
    "",
  ];

  for (const host of unsafe) {
    test(`refuses "${host}"`, () => {
      expect(isUnsafeHost(host)).toBe(true);
    });
  }

  const privateAddresses = [
    ["0.0.0.0", "this network"],
    ["0.1.2.3", "this network"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["127.0.0.1", "loopback"],
    ["127.1", "loopback shorthand"],
    ["2130706433", "loopback as one number"],
    ["0x7f000001", "loopback in hexadecimal"],
    ["017700000001", "loopback in octal"],
    ["100.64.0.1", "carrier-grade NAT, first"],
    ["100.127.255.255", "carrier-grade NAT, last"],
    ["169.254.169.254", "cloud metadata"],
    ["169.254.0.1", "link-local"],
    ["172.16.0.1", "private, first"],
    ["172.31.255.255", "private, last"],
    ["192.0.0.1", "IETF protocol assignments"],
    ["192.168.0.1", "private"],
    ["198.18.0.1", "benchmarking"],
    ["198.19.255.255", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
  ] as const;

  for (const [host, why] of privateAddresses) {
    test(`refuses ${host} (${why})`, () => {
      expect(isUnsafeHost(host)).toBe(true);
    });
  }

  const publicAddresses = [
    "8.8.8.8",
    "1.1.1.1",
    "99.63.255.255",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.0.1",
    "169.255.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.1.0.1",
    "192.167.0.1",
    "192.169.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "223.255.255.255",
  ];

  for (const host of publicAddresses) {
    test(`allows ${host}, which is public`, () => {
      expect(isUnsafeHost(host)).toBe(false);
    });
  }

  test("refuses loopback and unspecified IPv6", () => {
    expect(isUnsafeHost("[::1]")).toBe(true);
    expect(isUnsafeHost("[::]")).toBe(true);
    expect(isUnsafeHost("[0:0:0:0:0:0:0:1]")).toBe(true);
  });

  test("refuses unique-local and link-local IPv6", () => {
    expect(isUnsafeHost("[fc00::1]")).toBe(true);
    expect(isUnsafeHost("[fd12:3456::1]")).toBe(true);
    expect(isUnsafeHost("[fe80::1]")).toBe(true);
    expect(isUnsafeHost("[feb0::1]")).toBe(true);
  });

  test("refuses an IPv4-mapped IPv6 address pointing somewhere private", () => {
    expect(isUnsafeHost("[::ffff:127.0.0.1]")).toBe(true);
    expect(isUnsafeHost("[::ffff:169.254.169.254]")).toBe(true);
  });

  test("allows an IPv4-mapped IPv6 address pointing somewhere public", () => {
    expect(isUnsafeHost("[::ffff:8.8.8.8]")).toBe(false);
  });

  test("allows a public IPv6 address", () => {
    expect(isUnsafeHost("[2606:4700::1111]")).toBe(false);
  });

  test("refuses a zero-padded numeric host outright", () => {
    /*
     * The heart of the problem: "010.0.0.1" is 8.0.0.1 to a parser that reads
     * the leading zero as octal and 10.0.0.1 — a private address — to one that
     * does not. A safety check that has to guess which reader comes next is not
     * a safety check, so anything zero-padded is refused.
     */
    expect(isUnsafeHost("010.0.0.1")).toBe(true);
    expect(isUnsafeHost("0177.0.0.1")).toBe(true);
    expect(isUnsafeHost("0178.0.0.1")).toBe(true);
    expect(isUnsafeHost("192.0168.0.1")).toBe(true);
  });

  test("refuses a numeric host it cannot pin down", () => {
    // Numeric, but not an address anybody agrees on.
    expect(isUnsafeHost("1.2.3.4.5")).toBe(true);
    expect(isUnsafeHost("999.999.999.999")).toBe(true);
    expect(isUnsafeHost("4294967296")).toBe(true);
    expect(isUnsafeHost("1.2.3.")).toBe(true);
  });

  test("allows an ordinary public hostname", () => {
    expect(isUnsafeHost("instagram.com")).toBe(false);
    expect(isUnsafeHost("www.youtube.com")).toBe(false);
    expect(isUnsafeHost("open.spotify.com")).toBe(false);
  });

  test("is not fooled by a public host that merely reads as private", () => {
    // The suffix rule matches a label boundary, not a substring.
    expect(isUnsafeHost("localhost.com")).toBe(false);
    expect(isUnsafeHost("mylocal.com")).toBe(false);
    expect(isUnsafeHost("internal-affairs.com")).toBe(false);
  });
});
