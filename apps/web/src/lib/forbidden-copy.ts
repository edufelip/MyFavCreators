/**
 * The words the product may never use to describe itself.
 *
 * Money here buys prominence on a billboard. It is not a donation, not a tip,
 * not a contribution to a creator, and not a game of chance — and every one of
 * these words tells a visitor otherwise. They are banned outright everywhere
 * except one place: `/regras` exists to answer "is this a vaquinha?", and it
 * cannot answer without saying the word.
 *
 * So the rule on that page is not "exempt" but "only to deny". This module is
 * what decides whether a given use is a denial, and it lives in the app rather
 * than in a test so that the rule itself can be tested directly against the
 * sentences somebody might actually write.
 */
export const FORBIDDEN_TERMS = [
  "apoie",
  "apoio",
  "apoiar",
  "doe",
  // One spelling each: matching folds accents away, so carrying "doacao"
  // alongside "doação" would report the same word twice.
  "doação",
  "vaquinha",
  "contribuição",
  "gorjeta",
  "repasse",
  // The English terms the specification names too. A word boundary keeps them
  // from firing on Portuguese words that merely contain them — "fund" does not
  // match "fundo", "tip" does not match "múltiplo".
  "support",
  "donate",
  "tip",
  "fund",
  "sorteio",
  "concorra",
  "prêmio em dinheiro",
  "chance de ganhar",
] as const;

/**
 * Words that turn a mention into a denial.
 *
 * `sem` is deliberately absent. It is an everyday preposition — "sem custo",
 * "sem parar" — so accepting it would exempt any sentence that happened to
 * contain one, which is most of them. A denial has to actually deny.
 */
// Written against folded text, so the accented forms need no separate branch.
const DENIAL = /\b(nao|nunca|nenhum|nenhuma|jamais|nem)\b/i;

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
      // Zero-width characters, which are invisible and split a word in two as
      // far as any pattern is concerned.
      .replace(/[\u200b-\u200d\ufeff]/g, "")
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
function inflect(word: string): string {
  return word.endsWith("ao") ? `${word.slice(0, -2)}(?:ao|oes)` : `${word}(?:es|s)?`;
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
  const inflected = fold(term).split(" ").map(inflect).join(String.raw`\s+`);
  return new RegExp(`(^|[^a-z])(${inflected})([^a-z]|$)`, "gi");
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
  const normalized = fold(text.toLowerCase().replace(/\s+/g, " "));
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
