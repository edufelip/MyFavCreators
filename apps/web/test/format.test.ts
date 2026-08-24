import { describe, expect, test } from "bun:test";
import { formatBrl, formatDuration, formatHandle, initialsOf } from "../src/lib/format";

describe("formatBrl", () => {
  test("renders the amounts used across the product copy", () => {
    expect(formatBrl(500)).toBe("R$5");
    expect(formatBrl(1_000)).toBe("R$10");
    expect(formatBrl(2_500)).toBe("R$25");
    expect(formatBrl(9_500)).toBe("R$95");
    expect(formatBrl(28_600)).toBe("R$286");
  });

  test("keeps centavos when the amount is not whole reais", () => {
    expect(formatBrl(9_990)).toBe("R$99,90");
    expect(formatBrl(505)).toBe("R$5,05");
  });

  test("groups thousands the Brazilian way", () => {
    expect(formatBrl(258_200)).toBe("R$2.582");
    expect(formatBrl(1_234_567)).toBe("R$12.345,67");
  });

  test("refuses anything that is not non-negative integer centavos", () => {
    expect(() => formatBrl(99.9)).toThrow(RangeError);
    expect(() => formatBrl(-100)).toThrow(RangeError);
    expect(() => formatBrl(Number.NaN)).toThrow(RangeError);
  });

  test("renders zero", () => {
    expect(formatBrl(0)).toBe("R$0");
  });
});

describe("formatDuration", () => {
  test("shows days, hours and minutes while more than a day remains", () => {
    expect(formatDuration(3 * 86_400_000 + 8 * 3_600_000 + 12 * 60_000 + 45_000)).toBe(
      "3d 08h 12m",
    );
  });

  test("counts seconds down on the final day", () => {
    expect(formatDuration(8 * 3_600_000 + 12 * 60_000 + 45_000)).toBe("08h 12m 45s");
    expect(formatDuration(59_000)).toBe("00h 00m 59s");
  });

  test("never goes negative once the period closes", () => {
    expect(formatDuration(0)).toBe("00h 00m 00s");
    expect(formatDuration(-5_000)).toBe("00h 00m 00s");
  });
});

describe("formatHandle", () => {
  test("shows the familiar @handle form", () => {
    expect(formatHandle("marabeats", "SPOTIFY")).toBe("@marabeats");
    expect(formatHandle("@lunaverso", "YOUTUBE")).toBe("@lunaverso");
  });

  test("leaves a website handle alone", () => {
    expect(formatHandle("exemplo.com.br", "WEBSITE")).toBe("exemplo.com.br");
  });
});

describe("initialsOf", () => {
  test("takes the first and last initials", () => {
    expect(initialsOf("Luna Verso")).toBe("LV");
    expect(initialsOf("Coral do Beco")).toBe("CB");
    expect(initialsOf("Ori")).toBe("O");
  });
});
