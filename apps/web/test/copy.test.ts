import { describe, expect, test } from "bun:test";
import { copy } from "../src/lib/copy";
/*
 * The module's own matcher, not a second one written here.
 *
 * Sharing the *list* was not enough. This file used to apply its own whole-word
 * regex to it, which agreed with the module for exactly as long as the entries
 * were whole words — and the day they became stems, `apoi` stopped matching
 * "apoie", `doa` stopped matching "doação", and this test went on passing while
 * detecting none of the specification's Portuguese words. Nothing failed. A
 * rule shared as data and re-implemented at each call site is not shared.
 */
import { affirmativeUses, FORBIDDEN_TERMS } from "../src/lib/forbidden-copy";

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
      const uses = affirmativeUses(text);
      expect(
        uses.map((use) => use.term),
        `"${text}" uses a forbidden term without denying it`,
      ).toEqual([]);
    }
  });

  test("the shared list still holds the words the specification names", () => {
    /*
     * The scan above is only as good as the list behind it, and a list is
     * silent when something goes missing from it. These are the entries whose
     * removal would take a whole idea out of the rule.
     */
    const required: ReadonlyArray<(typeof FORBIDDEN_TERMS)[number]> = [
      "apoi",
      "doa",
      "vaquinh",
      "gorjet",
      "repass",
      "sorteio",
      "rifa",
    ];
    // Typed against the list, so removing one of these does not merely fail
    // this assertion — it stops the file compiling, naming the entry.
    for (const stem of required) {
      expect(FORBIDDEN_TERMS, stem).toContain(stem);
    }
  });

  test("the scan really catches the claims it is for", () => {
    // Otherwise the test above passes on an empty list, a broken matcher, or a
    // copy bank that happens to say nothing — which is how it passed before.
    for (const claim of [
      "Apoie seu criador favorito",
      "Faça sua doação agora",
      "Isto é uma vaquinha entre fãs",
      "Deixe uma gorjeta",
      "Sua contribuição ajuda",
      "O repasse é mensal",
      "Participe do sorteio semanal",
      "Concorra a prêmios em dinheiro",
    ]) {
      expect(affirmativeUses(claim).length, claim).toBeGreaterThan(0);
    }
  });

  test("and leaves the mandated disclosure alone", () => {
    /*
     * "Nenhum valor é repassado ao criador" contains `repass`, and must. The
     * rule is not "never say the word" but "never say it without the denial" —
     * a plain-occurrence scan would fail the one sentence the specification
     * requires verbatim, and the obvious way to make that green is to delete
     * the word from the list.
     */
    expect(affirmativeUses(copy.disclosure)).toEqual([]);
    expect(copy.disclosure).toContain("repassado");
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
