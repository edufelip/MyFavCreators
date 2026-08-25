import { describe, expect, test } from "bun:test";
import { copy } from "../src/lib/copy";
// One list, shared with the rendered-page scan. A second copy is a second thing
// to forget to update, and the two drifted: the page scan was missing three of
// the specification's English terms while this one had them.
import { FORBIDDEN_TERMS } from "../src/lib/forbidden-copy";

/** Every string the copy bank can produce, with sample arguments applied. */
function allCopyStrings(): string[] {
  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (typeof value === "function") {
      strings.push(String(value("exemplo", "R$95", 2, 1)));
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const nested of Object.values(value)) {
        walk(nested);
      }
    }
  };
  walk(copy);
  return strings;
}

describe("public copy", () => {
  test("never implies a payout, a donation or a game of chance", () => {
    for (const text of allCopyStrings()) {
      const normalized = text.toLowerCase();
      for (const term of FORBIDDEN_TERMS) {
        expect(
          new RegExp(`(^|[^a-zà-ú])${term}([^a-zà-ú]|$)`, "i").test(normalized),
          `"${text}" contains the forbidden term "${term}"`,
        ).toBe(false);
      }
    }
  });

  test("never claims money reaches the creator", () => {
    const joined = allCopyStrings().join(" ").toLowerCase();
    expect(joined.includes("dinheiro vai para o criador")).toBe(false);
    expect(joined.includes("vai para o criador")).toBe(false);
  });

  test("carries the copy bank verbatim", () => {
    expect(copy.hero.headline).toBe("O outdoor das torcidas.");
    expect(copy.hero.subheadline).toBe("Impulsione um perfil. Compre destaque. Dispute o topo.");
    expect(copy.cta.boost).toBe("IMPULSIONAR");
    expect(copy.cta.takeFirstPlace("R$95")).toBe("Assuma o #1 por R$95");
    expect(copy.rotation.title).toBe("Impulsionados agora");
    expect(copy.fanRanking.title("lunaverso")).toBe("Torcida de @lunaverso");
    expect(copy.countdown.label("2d 04h 11m")).toBe("O ranking semanal zera em 2d 04h 11m");
    expect(copy.creator.unclaimed).toBe("É você? Reivindique ou solicite a remoção desta página.");
    expect(copy.creator.emailOptIn("lunaverso")).toBe("Me avise se @lunaverso perder o topo");
    expect(copy.notifications.dethroneSubject("lunaverso", "R$95")).toBe(
      "@lunaverso caiu para #2 - R$95 retoma o topo",
    );
    expect(copy.boost.success("lunaverso", "R$95", 8, 1)).toBe(
      "🎉 Você impulsionou @lunaverso com R$95 - #8 -> #1",
    );
    expect(copy.boost.share("lunaverso", 8, 1)).toBe(
      "Eu impulsionei @lunaverso. #8 -> #1 🔥 Quem leva ao #1?",
    );
    expect(copy.heatMode.label).toBe("DECIDE HOJE");
  });

  test("carries the rank quote disclosure verbatim", () => {
    expect(copy.rankQuoteDisclosure).toBe(
      "Valor calculado com base no ranking atual. A posição pode mudar antes da confirmação do PIX.",
    );
  });

  test("never guarantees a rank, an impression or a click", () => {
    const joined = allCopyStrings().join(" ").toLowerCase();
    for (const promise of ["garantimos", "garantido", "garantia"]) {
      expect(joined.includes(promise)).toBe(false);
    }
  });
});
