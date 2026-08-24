import { describe, expect, test } from "bun:test";
import {
  creatorSlugCandidate,
  SLUG_MAX_LENGTH,
  slugify,
  withSlugDiscriminator,
} from "../src/creator";

describe("slugify", () => {
  test("folds Portuguese accents to ASCII", () => {
    expect(slugify("Téo Baião")).toBe("teo-baiao");
    expect(slugify("Sabiá Elétrico")).toBe("sabia-eletrico");
    expect(slugify("Comédia & Música")).toBe("comedia-musica");
    expect(slugify("Ação")).toBe("acao");
  });

  test("collapses punctuation and whitespace into single dashes", () => {
    expect(slugify("  Grupo   Maré / Alta!! ")).toBe("grupo-mare-alta");
    expect(slugify("a---b")).toBe("a-b");
  });

  test("never starts or ends with a dash", () => {
    expect(slugify("---luna---")).toBe("luna");
    expect(slugify("!!!")).toBe("");
  });

  test("caps the length without leaving a trailing dash", () => {
    const slug = slugify(`${"a".repeat(58)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });

  test("drops characters no URL should carry", () => {
    expect(slugify("luna/../verso")).toBe("luna-verso");
    expect(slugify("luna?x=1#y")).toBe("luna-x-1-y");
    expect(slugify("🎵 Luna 🎵")).toBe("luna");
  });

  test("is idempotent", () => {
    for (const input of ["Téo Baião", "Grupo Maré Alta", "luna-verso"]) {
      expect(slugify(slugify(input))).toBe(slugify(input));
    }
  });
});

describe("creatorSlugCandidate", () => {
  test("prefers the display name", () => {
    expect(creatorSlugCandidate("Luna Verso", "@lunaverso")).toBe("luna-verso");
  });

  test("falls back to the handle when the name yields nothing", () => {
    expect(creatorSlugCandidate("🎵🎵🎵", "@lunaverso")).toBe("lunaverso");
  });

  test("returns null when neither is usable, so the caller must decide", () => {
    expect(creatorSlugCandidate("🎵", "🎵")).toBeNull();
  });
});

describe("withSlugDiscriminator", () => {
  test("appends the discriminator", () => {
    expect(withSlugDiscriminator("luna-verso", 2)).toBe("luna-verso-2");
  });

  test("stays within the length cap", () => {
    const long = "a".repeat(SLUG_MAX_LENGTH);
    const result = withSlugDiscriminator(long, 12);
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(result.endsWith("-12")).toBe(true);
  });
});
