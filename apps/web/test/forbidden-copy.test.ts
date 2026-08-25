import { describe, expect, test } from "bun:test";
import { affirmativeUses, forbiddenTerms } from "../src/lib/forbidden-copy";

describe("finding a forbidden word at all", () => {
  test("finds one standing on its own", () => {
    expect(forbiddenTerms("Isto é uma vaquinha")).toEqual(["vaquinha"]);
  });

  test("does not fire on a word that merely contains one", () => {
    // "doe" inside "doente", "apoio" inside a longer word.
    expect(forbiddenTerms("um criador doente")).toEqual([]);
    expect(forbiddenTerms("apoiozinho")).toEqual([]);
  });

  test("finds one regardless of case or accent form used in the copy", () => {
    expect(forbiddenTerms("DOAÇÃO")).toContain("doação");
    expect(forbiddenTerms("Doacao")).toContain("doacao");
  });
});

describe("a denial makes the mention allowed", () => {
  const allowed = [
    "Não é vaquinha.",
    "Isto não é uma doação.",
    "Não é apoio financeiro ao criador.",
    "Um perfil nunca entra em sorteio.",
    "Nenhum valor é repasse ao criador.",
    "Nem doação nem gorjeta.",
  ];

  for (const sentence of allowed) {
    test(`allows "${sentence}"`, () => {
      expect(affirmativeUses(sentence)).toEqual([]);
    });
  }
});

describe("a negation somewhere in the sentence does not launder an affirmative use", () => {
  /*
   * Every one of these passed the previous check, which asked only whether the
   * sentence contained a negation anywhere. They are the reason the denial now
   * has to sit next to the word it denies.
   */
  const laundered = [
    "O rodízio é um sorteio de exibição entre os perfis elegíveis, e não depende do valor pago.",
    "Todo impulso ganha um prêmio em dinheiro sem custo adicional.",
    "Faça uma doação para o criador, não é obrigatório.",
    "Você recebe um repasse mensal, e não precisa fazer nada.",
  ];

  for (const sentence of laundered) {
    test(`rejects "${sentence.slice(0, 44)}…"`, () => {
      expect(affirmativeUses(sentence).length).toBeGreaterThan(0);
    });
  }

  test("a denial does not reach past the clause it belongs to", () => {
    /*
     * The subtler version: the sentence really does deny something, and then
     * says the opposite thing about a second term beside it. `/regras` is the
     * one page allowed to name these words at all, so this is the shape that
     * would actually get written there by accident.
     */
    expect(affirmativeUses("Não é vaquinha, é uma doação para o criador.").length).toBe(1);
    expect(
      affirmativeUses("Isto não é um sorteio, mas concorra ao topo desta semana.").length,
    ).toBe(1);
    expect(affirmativeUses("Não cobramos taxa; faça uma doação hoje.").length).toBe(1);
    expect(affirmativeUses("Nada é obrigatório — apoie seu criador favorito.").length).toBe(1);
  });

  test("`sem` alone never counts as a denial", () => {
    expect(affirmativeUses("Concorra sem pagar nada.").length).toBe(1);
    expect(affirmativeUses("Uma vaquinha sem taxas.").length).toBe(1);
  });
});

describe("sentence boundaries", () => {
  test("a denial in the previous sentence does not reach into this one", () => {
    expect(affirmativeUses("Isto não é um leilão. Faça uma doação hoje.").length).toBe(1);
  });

  test("a heading followed by a denial does not exempt the heading", () => {
    // Headings arrive without punctuation, so the two used to merge into one
    // "sentence" and the denial below covered the heading above.
    expect(affirmativeUses("Sorteio semanal Não é um jogo de azar.").length).toBe(1);
  });

  test("a colon ends the reach of a denial, the way a heading does", () => {
    expect(affirmativeUses("Não é isto: doação mensal ao criador.").length).toBe(1);
  });

  test("a far-away denial in the same long sentence does not count", () => {
    const far = `Faça uma doação${" e mais texto".repeat(6)}, mas não é obrigatório.`;
    expect(affirmativeUses(far).length).toBe(1);
  });
});

describe("the real denials on /regras still pass", () => {
  test("each one is close enough to the word it denies", () => {
    const page = [
      "Não é vaquinha, não é doação e não é apoio financeiro.",
      "Um perfil nunca entra em sorteio, rifa ou prêmio.",
      "Nenhum valor é repassado ao criador.",
    ].join(" ");
    expect(affirmativeUses(page)).toEqual([]);
  });
});
