import { describe, expect, test } from "bun:test";
import {
  BoostAmountError,
  MAX_BOOST_CENTS,
  resolveSupporterDetails,
  sanitizeSupporterText,
  validateBoostAmount,
} from "../src/boost/request";
import { centsValue } from "../src/money";

describe("boost amount", () => {
  test("accepts the quick values and a Take #1 quote", () => {
    for (const amount of [500, 1_000, 2_500, 9_500, 48_700]) {
      expect(centsValue(validateBoostAmount(amount, 500))).toBe(amount);
    }
  });

  test("refuses anything below the minimum boost", () => {
    expect(() => validateBoostAmount(499, 500)).toThrow(BoostAmountError);
    expect(() => validateBoostAmount(1, 500)).toThrow(/mínimo/);
  });

  test("refuses zero, negative and fractional amounts", () => {
    for (const amount of [0, -500, 5.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateBoostAmount(amount, 500), String(amount)).toThrow(BoostAmountError);
    }
  });

  test("refuses an absurd amount a typo or a tampered form could produce", () => {
    expect(() => validateBoostAmount(MAX_BOOST_CENTS + 1, 500)).toThrow(BoostAmountError);
    expect(centsValue(validateBoostAmount(MAX_BOOST_CENTS, 500))).toBe(MAX_BOOST_CENTS);
  });

  test("honours a configured minimum other than the default", () => {
    expect(() => validateBoostAmount(500, 1_000)).toThrow(BoostAmountError);
    expect(centsValue(validateBoostAmount(1_000, 1_000))).toBe(1_000);
  });
});

describe("supporter text", () => {
  test("trims, collapses whitespace and caps the length", () => {
    expect(sanitizeSupporterText("  Marina   Silva  ", 40)).toBe("Marina Silva");
    expect(sanitizeSupporterText("a".repeat(100), 40)).toHaveLength(40);
  });

  test("removes control and direction-override characters", () => {
    expect(sanitizeSupporterText("Mari\u0000na", 40)).toBe("Mari na");
    expect(sanitizeSupporterText("texto\u202Eodagerp", 40)).toBe("texto odagerp");
    expect(sanitizeSupporterText("linha\numa", 40)).toBe("linha uma");
    expect(sanitizeSupporterText("zero\u200Bwidth", 40)).toBe("zero width");
  });

  test("treats blank input as absent", () => {
    expect(sanitizeSupporterText("   ", 40)).toBeNull();
    expect(sanitizeSupporterText("", 40)).toBeNull();
    expect(sanitizeSupporterText(null, 40)).toBeNull();
    expect(sanitizeSupporterText(undefined, 40)).toBeNull();
  });

  test("keeps text that only looks like markup, because it is never markup", () => {
    // The message is plain text and React escapes on render, so this survives
    // intact rather than being silently mangled.
    expect(sanitizeSupporterText("<b>vamos</b> & cia", 140)).toBe("<b>vamos</b> & cia");
  });

  test("redacts Brazilian CPFs in formatted and unformatted forms", () => {
    expect(sanitizeSupporterText("Apoio CPF 123.456.789-00 parabéns", 140)).toBe(
      "Apoio CPF [dado protegido] parabéns",
    );
    expect(sanitizeSupporterText("Doc: 123.456.789.00", 140)).toBe("Doc: [dado protegido]");
    expect(sanitizeSupporterText("meu cpf 12345678901 aqui", 140)).toBe(
      "meu cpf [dado protegido] aqui",
    );
  });

  test("redacts Brazilian mobile and landline phone numbers with DDD", () => {
    expect(sanitizeSupporterText("me liga no (11) 99999-9999", 140)).toBe(
      "me liga no [dado protegido]",
    );
    expect(sanitizeSupporterText("fone: 11 98888 7777", 140)).toBe("fone: [dado protegido]");
    expect(sanitizeSupporterText("whats +55 21 98765-4321!", 140)).toBe("whats [dado protegido]!");
    expect(sanitizeSupporterText("fixo (11) 3456-7890", 140)).toBe("fixo [dado protegido]");
    expect(sanitizeSupporterText("cel: (11) 9 8888-7777", 140)).toBe("cel: [dado protegido]");
  });

  test("redacts email addresses while preserving trailing punctuation", () => {
    expect(sanitizeSupporterText("contato suporte@creator.com para infos", 140)).toBe(
      "contato [dado protegido] para infos",
    );
    expect(sanitizeSupporterText("email: teste.user+tag@domain.co.uk!", 140)).toBe(
      "email: [dado protegido]!",
    );
  });

  test("never produces false positives on dates, ranks, amounts or benign numbers", () => {
    expect(sanitizeSupporterText("Impulso de R$ 50 para o top 1", 140)).toBe(
      "Impulso de R$ 50 para o top 1",
    );
    expect(sanitizeSupporterText("Ano 2026 com tudo", 140)).toBe("Ano 2026 com tudo");
    expect(sanitizeSupporterText("Temporada 2025-2026", 140)).toBe("Temporada 2025-2026");
    expect(sanitizeSupporterText("Criador #123 vamos lá", 140)).toBe("Criador #123 vamos lá");
    expect(sanitizeSupporterText("Meta 1000 / 2000 pontos", 140)).toBe("Meta 1000 / 2000 pontos");
    expect(sanitizeSupporterText("R$ 100.000,00 para o campeão", 140)).toBe(
      "R$ 100.000,00 para o campeão",
    );
  });

  test("redacts PII near character limit boundary before length clipping", () => {
    const padded = `${"a".repeat(120)} 123.456.789-00`;
    const sanitized = sanitizeSupporterText(padded, 140);
    expect(sanitized).not.toContain("123.456");
    expect(sanitized).toContain("[dado protegido]");
    expect(sanitized?.length).toBeLessThanOrEqual(140);
  });
});

describe("supporter details", () => {
  test("an anonymous boost stores no name and no message at all", () => {
    expect(
      resolveSupporterDetails({
        anonymous: true,
        supporterName: "Marina",
        supporterMessage: "Vamos pro topo",
        nameMaxLength: 40,
        messageMaxLength: 140,
      }),
    ).toEqual({ anonymous: true, supporterName: null, supporterMessage: null });
  });

  test("a named boost keeps sanitized values", () => {
    expect(
      resolveSupporterDetails({
        anonymous: false,
        supporterName: "  Marina  ",
        supporterMessage: "  Vamos pro topo.  ",
        nameMaxLength: 40,
        messageMaxLength: 140,
      }),
    ).toEqual({
      anonymous: false,
      supporterName: "Marina",
      supporterMessage: "Vamos pro topo.",
    });
  });

  test("respects the configured limits", () => {
    const details = resolveSupporterDetails({
      anonymous: false,
      supporterName: "n".repeat(80),
      supporterMessage: "m".repeat(400),
      nameMaxLength: 40,
      messageMaxLength: 140,
    });
    expect(details.supporterName).toHaveLength(40);
    expect(details.supporterMessage).toHaveLength(140);
  });
});
