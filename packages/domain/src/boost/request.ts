import { type MoneyCents, moneyCents } from "../money/money";

export class BoostAmountError extends Error {
  override readonly name = "BoostAmountError";
}

/** A ceiling no legitimate boost reaches, so a typo cannot create an absurd payment. */
export const MAX_BOOST_CENTS = 100_000_00;

/**
 * The amount a boost may be created for.
 *
 * The exact amount paid becomes the exact amount applied, so this is the only
 * place an amount is allowed in, and it is checked before a payment exists
 * rather than after money has moved.
 */
export function validateBoostAmount(amountCents: number, minBoostCents: number): MoneyCents {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new BoostAmountError("A boost amount must be a positive whole number of centavos");
  }
  if (amountCents < minBoostCents) {
    throw new BoostAmountError(`O valor mínimo para impulsionar é de ${minBoostCents} centavos`);
  }
  if (amountCents > MAX_BOOST_CENTS) {
    throw new BoostAmountError(`O valor máximo para impulsionar é de ${MAX_BOOST_CENTS} centavos`);
  }
  return moneyCents(amountCents);
}

/**
 * Replaces control and bidirectional-override characters with a space.
 *
 * Supporter messages are plain text and are never interpreted as markup, so this
 * is not an HTML sanitizer. It exists so a message cannot smuggle line breaks or
 * a right-to-left override into a supporter wall or an email subject line.
 */
function stripControlCharacters(value: string): string {
  return value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\uFEFF]/g,
    " ",
  );
}

export function sanitizeSupporterText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = stripControlCharacters(value).replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned.slice(0, maxLength);
}

export type SupporterDetailsInput = {
  readonly anonymous: boolean;
  readonly supporterName?: string | null | undefined;
  readonly supporterMessage?: string | null | undefined;
  readonly nameMaxLength: number;
  readonly messageMaxLength: number;
};

export type SupporterDetails = {
  readonly anonymous: boolean;
  readonly supporterName: string | null;
  readonly supporterMessage: string | null;
};

/**
 * What a boost records about its supporter.
 *
 * An anonymous boost stores no name and no message at all, rather than storing
 * them and hiding them at render time: a field that is never written cannot leak
 * through a future endpoint, an export, or a bug.
 */
export function resolveSupporterDetails(input: SupporterDetailsInput): SupporterDetails {
  if (input.anonymous) {
    return { anonymous: true, supporterName: null, supporterMessage: null };
  }
  return {
    anonymous: false,
    supporterName: sanitizeSupporterText(input.supporterName, input.nameMaxLength),
    supporterMessage: sanitizeSupporterText(input.supporterMessage, input.messageMaxLength),
  };
}
