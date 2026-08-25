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
  "doação",
  "doacao",
  "vaquinha",
  "contribuição",
  "contribuicao",
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
const DENIAL = /\b(n[ãa]o|nunca|nenhum|nenhuma|jamais|nem)\b/i;

/**
 * How far before a forbidden word a denial may sit and still be attached to it.
 *
 * Long enough for "nunca entra em sorteio" and "não é apoio financeiro", short
 * enough that a "não" at the far end of a long sentence does not launder an
 * affirmative use at the near end.
 */
const DENIAL_WINDOW = 40;

/** Punctuation that ends a clause, and so ends a denial's reach. */
const CLAUSE_ENDS = [".", "!", "?", ":", ";", ",", "—", "–"] as const;

export type AffirmativeUse = {
  readonly term: string;
  /** The text around the use, for an error message somebody can act on. */
  readonly context: string;
};

function boundary(term: string): RegExp {
  return new RegExp(`(^|[^a-zà-ú])(${term})([^a-zà-ú]|$)`, "gi");
}

/** Every forbidden term appearing anywhere in the text, denied or not. */
export function forbiddenTerms(text: string): readonly string[] {
  const normalized = text.toLowerCase();
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
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
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
