/**
 * The words the product may never use to describe itself.
 *
 * Money here buys prominence on a billboard. It is not a donation, not a tip,
 * not a contribution to a creator, and not a game of chance — and every one of
 * these words tells a visitor otherwise. They are banned outright everywhere
 * except one place: `/regras` exists to answer "is this a vaquinha?", and it
 * cannot answer without saying the word.
 *
 * So the rule on that page is not "exempt" but "only to deny", and the form the
 * denial has to take is deliberately narrow:
 *
 *   **Each forbidden word carries its own denial, in its own clause.**
 *
 * "Não é vaquinha, não é doação e não é apoio" passes. "Nunca entra em sorteio,
 * rifa ou prêmio" does not — the denial governs the list in Portuguese, but it
 * is one comma away from "não é vaquinha, é uma doação", which reads almost the
 * same and means the opposite. Deciding between them needs a parser; requiring
 * the repetition needs nothing, costs a few words, and fails closed.
 *
 * This module lives in the app rather than in a test so the rule itself can be
 * tested directly against the sentences somebody might actually write.
 */
export const FORBIDDEN_TERMS = [
  /*
   * Portuguese entries are stems, not words. Matching whole words caught
   * "apoie" and missed "apoiando", "apoiador" and "apoiamos" — one step
   * sideways from the same claim. A stem matches every derivation of it, which
   * is what the rule is actually about.
   *
   * One spelling each: matching folds accents away, so carrying "doacao"
   * alongside "doação" would report the same word twice.
   */
  "apoi",
  "doa",
  "vaquinh",
  "contribu",
  "gorjet",
  "repass",
  /*
   * Words that name the same thing without being on the specification's list.
   * "Financiamento coletivo" is the standard Brazilian term for a vaquinha and
   * the one a lawyer would reach for; "caixinha" is the everyday tip jar. A
   * list covering only the words somebody thought of stops working the moment
   * somebody thinks of another.
   */
  "financiamento coletivo",
  "caixinh",
  /*
   * Only the forms that ask for money. As a stem this fired on "trabalho
   * colaborativo" and "nossos colaboradores" — ordinary words for ordinary
   * things — and a rule that flags the staff page is a rule somebody switches
   * off, which costs more than the word it was catching.
   */
  "colabore",
  /*
   * `sorteio` rather than `sorte`, deliberately. "Boa sorte" is an ordinary
   * thing to write, and a rule nobody can live with is a rule somebody removes.
   */
  "sorteio",
  "rifa",
  "concorra",
  "prêmio em dinheiro",
  "chance de ganhar",
  // The English terms the specification names. Matched exactly — see
  // EXACT_TERMS: `tip` as a stem would fire on "tipo", `fund` on "fundo".
  "support",
  "donate",
  // Its own entry because "donation" is not "donate" plus a suffix, and it is
  // the form an English page is likelier to use than the verb.
  "donation",
  "tip",
  // English doubles the consonant here, so no suffix on "tip" produces it.
  "tipping",
  "fund",
  "crowdfunding",
] as const;

/**
 * Terms matched as whole words rather than as stems.
 *
 * Every one is an English word that is also the start of a common Portuguese
 * one. `tip[a-z]*` matches "tipo" and "típico"; `fund[a-z]*` matches "fundo"
 * and "fundamental". A check that cries wolf on ordinary copy is a check
 * somebody switches off.
 */
const EXACT_TERMS = new Set<string>([
  "support",
  "donate",
  "donation",
  "tip",
  "tipping",
  "fund",
  "crowdfunding",
  "colabore",
]);

/**
 * The English endings, spelled out rather than stemmed.
 *
 * `(?:es|s)?` covered plurals and nothing else, so "supporter", "supporters",
 * "donations" and "funding" all walked through — the derivations an English
 * page actually uses. A stem cannot be used instead: `tip[a-z]*` matches
 * "tipo" and `fund[a-z]*` matches "fundo", both ordinary Portuguese.
 *
 * Every ending here begins with a letter that no Portuguese continuation of
 * these stems begins with, which is what keeps "tipo" and "fundo" out.
 */
const ENGLISH_ENDINGS = "(?:s|es|ing|ion|ions|er|ers|or|ors|ed)?";

/**
 * Words that turn a mention into a denial.
 *
 * `sem` is deliberately absent. It is an everyday preposition — "sem custo",
 * "sem parar" — so accepting it would exempt any sentence that happened to
 * contain one, which is most of them. A denial has to actually deny.
 */
// Written against folded text, so the accented forms need no separate branch.
const DENIAL = /\b(nao|nunca|nenhum|nenhuma|ninguem|jamais|nem)\b/i;

/**
 * How far before a forbidden word a denial may sit and still be attached to it.
 *
 * Long enough for "nunca entra em sorteio" and "não é apoio financeiro", short
 * enough that a "não" at the far end of a long sentence does not launder an
 * affirmative use at the near end.
 */
const DENIAL_WINDOW = 40;

/** Punctuation that ends a clause, and so ends a denial's reach. */
const CLAUSE_ENDS = [".", "!", "?", ":", ";", ",", "\u2014", "\u2013"] as const;

/**
 * Conjunctions that start a new clause, and so also end a denial's reach.
 *
 * Portuguese joins clauses with *e* and *mas* far more often than with a comma,
 * so punctuation alone covered about half the shape: "não é vaquinha e é uma
 * doação para o criador" passed. The real denials on /regras survive because
 * each term carries its own — "não é vaquinha, não é doação e não é apoio".
 */
const CLAUSE_STARTS = /\b(e|ou|mas|porem|entao|contudo|todavia)\b/g;

export type AffirmativeUse = {
  readonly term: string;
  /** The text around the use, for an error message somebody can act on. */
  readonly context: string;
};

/**
 * Strips accents so a term matches however it was typed.
 *
 * The list carries both `doação` and `doacao` for exactly this reason; folding
 * them here means the list only has to carry the idea once, and a term that
 * somebody writes without its accent is still the same word.
 */
function fold(text: string): string {
  return (
    text
      /*
       * Invisible characters go first, because everything below reads letters
       * and one of these sitting between two of them makes them different
       * words. `\ufeff` in particular is whitespace to a regex, so anything
       * that normalises spacing before this point turns it into a real one.
       */
      .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
      .normalize("NFC")
      /*
       * "é" is the verb *to be*; "e" is the conjunction *and*. Stripping accents
       * makes them the same word, and the clause rule below reads one as the
       * other — so "não é vaquinha" would look like a denial that ended before
       * it began. Kept apart under a spelling that is neither a conjunction nor
       * a forbidden term.
       */
      // `\b` is ASCII-only, so it never matches beside an accented letter — the
      // boundaries have to be spelled out.
      .replace(/(^|[^\p{L}])é(?![\p{L}])/giu, "$1eh")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  );
}

/**
 * The term, in the forms it is actually written in.
 *
 * A plural is the same claim as a singular. Matching only the exact word let
 * "participe dos sorteios semanais" and "faça suas doações agora" through — the
 * affirmative `sorteio` this whole check was written to catch, wearing an `s`.
 */
/*
 * `-ão` needs its own branch: Portuguese pluralises it as `-ões`, which no
 * suffix on the singular can produce. Folded, that is `doacao` -> `doacoes`.
 */
/**
 * A word and every derivation of it.
 *
 * `-ão` needs its own branch: Portuguese pluralises it as `-ões`, which no
 * suffix on the singular can produce. Folded, that is `doacao` -> `doacoes`.
 *
 * Everything else takes a trailing `[a-z]*`, which covers plurals, verb forms
 * and agent nouns in one rule — `doar`, `doando`, `apoiador`, `sorteando`. It
 * over-matches by design: being told to rephrase costs a minute, and a page
 * that promises a donation costs more than that. The stem is `sorteio` rather
 * than `sorte` for the same reason in reverse — "boa sorte" is an ordinary
 * thing to write, and a rule nobody can live with is a rule somebody removes.
 */
function inflect(word: string, exact: boolean): string {
  if (exact) {
    return `${word}${ENGLISH_ENDINGS}`;
  }
  /*
   * `-ão` needs its own branch: Portuguese pluralises it as `-ões`, which no
   * suffix on the singular can produce. Folded, that is `doacao` -> `doacoes`.
   */
  return word.endsWith("ao") ? `${word.slice(0, -2)}(?:ao|oes|[a-z]*)` : `${word}[a-z]*`;
}

/** Where the nearest clause-starting conjunction before `at` ends. */
function lastConjunctionBefore(text: string, at: number): number {
  CLAUSE_STARTS.lastIndex = 0;
  let last = -1;
  for (const match of text.slice(0, at).matchAll(CLAUSE_STARTS)) {
    last = (match.index ?? 0) + match[0].length;
  }
  return last;
}

function boundary(term: string): RegExp {
  // Word by word, because a phrase pluralises on its head: the plural of
  // "premio em dinheiro" is "premios em dinheiro", not "premio em dinheiros".
  const exact = EXACT_TERMS.has(term);
  const inflected = fold(term)
    .split(" ")
    .map((word) => inflect(word, exact))
    .join(String.raw`\s+`);
  /*
   * The trailing boundary is a lookahead, not a match. Consuming it moved the
   * cursor past the separator, so "nao eh vaquinha vaquinha" reported the
   * first occurrence as denied and never saw the second at all — the second
   * being the affirmative one.
   */
  return new RegExp(`(^|[^a-z])(${inflected})(?=[^a-z]|$)`, "gi");
}

/** Every forbidden term appearing anywhere in the text, denied or not. */
export function forbiddenTerms(text: string): readonly string[] {
  const normalized = fold(text.toLowerCase());
  return FORBIDDEN_TERMS.filter((term) => boundary(term).test(normalized));
}

/**
 * Uses of a forbidden term that are not denied.
 *
 * The denial has to precede the term and sit close to it. Requiring only that
 * the sentence contain a negation somewhere lets "todo impulso ganha um prêmio
 * em dinheiro, e não custa nada" pass — technically negated, plainly a promise
 * of a cash prize.
 */
export function affirmativeUses(text: string): readonly AffirmativeUse[] {
  /*
   * Folded before the whitespace collapse, not after.
   *
   * `\ufeff` is whitespace to a JavaScript regex, so collapsing first turned a
   * zero-width no-break space *into a real space* — and "va\ufeffquinha", which
   * a reader sees as one word, became two before anything looked at it. The
   * one invisible character that defeats this check was the one the collapse
   * was quietly converting.
   */
  const normalized = fold(text.toLowerCase()).replace(/\s+/g, " ");
  const found: AffirmativeUse[] = [];

  for (const term of FORBIDDEN_TERMS) {
    for (const match of normalized.matchAll(boundary(term))) {
      const at = (match.index ?? 0) + (match[1]?.length ?? 0);
      /*
       * A denial belongs to its own clause, not merely to the sentence.
       * Stopping only at sentence-ending punctuation let the "não" that denies
       * one term launder a second, affirmative one beside it — "não é vaquinha,
       * é uma doação para o criador" passed. Commas, semicolons and dashes end
       * the reach too.
       */
      const sentenceStart = Math.max(
        ...CLAUSE_ENDS.map((mark) => normalized.lastIndexOf(mark, at - 1)),
        lastConjunctionBefore(normalized, at),
      );
      const from = Math.max(at - DENIAL_WINDOW, sentenceStart + 1, 0);
      if (!DENIAL.test(normalized.slice(from, at))) {
        found.push({
          term,
          context: normalized.slice(Math.max(at - DENIAL_WINDOW, 0), at + term.length + 20).trim(),
        });
      }
    }
  }
  return found;
}
