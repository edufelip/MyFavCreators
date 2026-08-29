import { describe, expect, test } from "bun:test";
import { affirmativeUses, forbiddenTerms } from "../src/lib/forbidden-copy";

describe("finding a forbidden word at all", () => {
  test("finds one standing on its own", () => {
    expect(forbiddenTerms("Isto é uma vaquinha")).toEqual(["vaquinh"]);
  });

  test("finds an inflected form, because a plural is the same claim", () => {
    /*
     * The affirmative `sorteio` this check was written to catch survived for a
     * while wearing an `s`: the matcher required a non-letter straight after the
     * term, so no plural ever matched.
     */
    expect(forbiddenTerms("Participe dos sorteios semanais")).toContain("sorteio");
    expect(forbiddenTerms("Faça suas doações agora")).toContain("doa");
    expect(forbiddenTerms("gorjetas são bem-vindas")).toContain("gorjet");
    expect(forbiddenTerms("Somos varias vaquinhas")).toContain("vaquinh");
    expect(forbiddenTerms("prêmios em dinheiro para o primeiro lugar")).toContain(
      "prêmio em dinheiro",
    );
  });

  test("finds a term written without its accent", () => {
    expect(forbiddenTerms("uma doacao")).not.toEqual([]);
    expect(forbiddenTerms("premio em dinheiro")).not.toEqual([]);
    expect(forbiddenTerms("contribuicao mensal")).not.toEqual([]);
  });

  test("does not fire on a word that merely contains one", () => {
    // "doe" inside "doente", "apoio" inside a longer word.
    expect(forbiddenTerms("um criador doente")).toEqual([]);
    // A stem matches every derivation, which is the point — including this one.
    expect(forbiddenTerms("apoiozinho")).toEqual(["apoi"]);
  });

  test("finds one regardless of case or accent form used in the copy", () => {
    expect(forbiddenTerms("DOAÇÃO")).toContain("doa");
    // Reported under the list's own spelling, whichever spelling was written.
    expect(forbiddenTerms("Doacao")).toContain("doa");
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

  test("an inflected form is not laundered either", () => {
    expect(affirmativeUses("Participe dos sorteios semanais.").length).toBeGreaterThan(0);
    expect(affirmativeUses("Faça suas doações hoje.").length).toBeGreaterThan(0);
  });

  test("a conjunction starts a new clause, so a denial does not carry across it", () => {
    /*
     * Portuguese joins clauses with *e* and *mas* far more often than with a
     * comma, so a punctuation-only rule covered about half the shape.
     */
    expect(affirmativeUses("Não é vaquinha e é uma doação para o criador.").length).toBe(1);
    expect(
      affirmativeUses("Aqui ninguém perde: não paga taxa e ganha um prêmio em dinheiro.").length,
    ).toBe(1);
    expect(
      affirmativeUses("Nunca cobramos taxa e todo impulso vira gorjeta para o criador.").length,
    ).toBe(1);
  });

  test("an invisible character does not hide a forbidden word", () => {
    expect(forbiddenTerms("sor\u200bteio semanal")).toContain("sorteio");
    expect(affirmativeUses("Participe do sor\u200bteio semanal.").length).toBe(1);
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
      "Impulsionar nunca entra em sorteio. Não é rifa.",
      "Nenhum valor é repassado ao criador.",
    ].join(" ");
    expect(affirmativeUses(page)).toEqual([]);
  });

  test("a coordinated list is refused, and that is the rule rather than a bug", () => {
    /*
     * "Nunca entra em sorteio, rifa ou prêmio" is correct Portuguese and the
     * denial does govern the list — but it is one comma away from "não é
     * vaquinha, é uma doação", which reads almost the same and means the
     * opposite. Telling them apart needs a parser; requiring each word to carry
     * its own denial needs nothing and fails closed.
     *
     * Pinned deliberately, so that nobody reading a flagged page "fixes" the
     * check instead of the sentence.
     */
    expect(affirmativeUses("Nunca entra em sorteio, rifa ou prêmio.").length).toBe(1);
    expect(affirmativeUses("Não é vaquinha ou doação.").length).toBe(1);
  });
});

describe("words that only look forbidden", () => {
  /**
   * The half of the rule that decides whether anybody keeps it.
   *
   * A check that flags the staff page gets switched off, and then it catches
   * nothing at all. Every string here is ordinary Portuguese somebody could
   * reasonably write on this site.
   */
  test("leaves ordinary words alone", () => {
    for (const ordinary of [
      "Trabalho colaborativo entre times",
      "Nossos colaboradores",
      "Boa sorte a todos",
      "Fundo de tela",
      "Um tipo de destaque",
      "Este é o tipo de fundo que usamos",
      "Fundamental para o ranking",
      "Típico de uma semana movimentada",
    ]) {
      expect(
        affirmativeUses(ordinary).map((use) => use.term),
        ordinary,
      ).toEqual([]);
    }
  });

  test("counts ninguém as a denial, because it is one", () => {
    // Missing from the denial list, so "Ninguém doa nada aqui" — a sentence
    // that denies the thing as plainly as "não" does — was reported.
    expect(affirmativeUses("Ninguém doa nada aqui")).toEqual([]);
    expect(affirmativeUses("Ninguém recebe repasse")).toEqual([]);
  });
});

describe("the English terms the specification names", () => {
  test("catches the forms an English page would actually use", () => {
    /*
     * The endings used to be `(?:es|s)?`, which covered plurals and nothing
     * else — so "supporter", "donations" and "funding" all passed while the
     * bare verbs were caught. Those are the words a page uses.
     */
    for (const claim of [
      "Make a donation today",
      "Donations welcome",
      "Become a supporter",
      "Our supporters",
      "Supporting your favourite creator",
      "Funding the creators",
      "Tipping is welcome",
      "Crowdfunding for creators",
      "Donate now",
      "Leave a tip",
    ]) {
      expect(affirmativeUses(claim).length, claim).toBeGreaterThan(0);
    }
  });

  test("and stays out of the Portuguese words that begin the same way", () => {
    // Which is why these are matched whole rather than stemmed: `tip[a-z]*`
    // fires on "tipo", `fund[a-z]*` on "fundo", and /regras itself says
    // "prêmio de qualquer tipo".
    expect(affirmativeUses("Impulsionar não é prêmio de qualquer tipo")).toEqual([]);
    expect(affirmativeUses("O fundo do card é escuro")).toEqual([]);
  });
});

describe("two occurrences of the same word", () => {
  test("are both found, not just the first", () => {
    /*
     * The trailing boundary used to be consumed rather than looked ahead at,
     * so the cursor landed past the separator and the second occurrence was
     * never examined — and in a coordinated phrase the second is the one that
     * is affirmative.
     */
    expect(affirmativeUses("vaquinha vaquinha")).toHaveLength(2);
    expect(affirmativeUses(`nao eh vaquinha, ${"palavra ".repeat(8)} vaquinha`)).toHaveLength(1);
  });
});

describe("invisible characters", () => {
  test("do not split a word out of the rule", () => {
    // Each of these renders as nothing and separates two letters as far as any
    // pattern is concerned.
    for (const invisible of ["\u00ad", "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"]) {
      const split = `Faça uma va${invisible}quinha`;
      expect(affirmativeUses(split).length, JSON.stringify(invisible)).toBeGreaterThan(0);
    }
  });
});

describe("the words the specification did not think of", () => {
  /**
   * Each of these was added because the published list covers only the words
   * somebody thought of, and that stops working the moment somebody thinks of
   * another. Without this, deleting any of them leaves the suite green.
   */
  test("names the same idea by its other names", () => {
    for (const claim of [
      "Financiamento coletivo para criadores",
      "Deixe algo na caixinha",
      "Colabore com o criador",
      "Participe da rifa semanal",
      "Crowdfunding for creators",
    ]) {
      expect(affirmativeUses(claim).length, claim).toBeGreaterThan(0);
    }
  });

  test("and still lets each of them be denied", () => {
    // The exemption has to reach these too, or /regras cannot answer "is this
    // a financiamento coletivo?" — which is the question it exists for.
    for (const denial of [
      "Não é financiamento coletivo.",
      "Não é caixinha.",
      "Ninguém colabora com o criador aqui.",
      "Não é rifa.",
    ]) {
      expect(
        affirmativeUses(denial).map((use) => use.term),
        denial,
      ).toEqual([]);
    }
  });
});
