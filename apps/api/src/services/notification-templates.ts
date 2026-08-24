import type { EmailMessage } from "../email/provider";

/**
 * The wording of every notification.
 *
 * Held apart from the sending so the copy rules are checkable in one place:
 * nothing here may imply that money reaches a creator, and nothing here may
 * promise a position, an audience or a result. A notification about a ranking
 * describes what happened on the platform and nothing else.
 */

export function unsubscribeUrl(webOrigin: string, token: string): string {
  return new URL(`/descadastrar/${encodeURIComponent(token)}`, webOrigin).toString();
}

export type DethroneEmailInput = {
  readonly to: string;
  readonly dethronedName: string;
  readonly dethronedSlug: string;
  readonly challengerName: string;
  readonly webOrigin: string;
  readonly unsubToken: string;
};

export function dethroneEmail(input: DethroneEmailInput): EmailMessage {
  const profileUrl = new URL(`/criador/${input.dethronedSlug}`, input.webOrigin).toString();
  const unsubscribe = unsubscribeUrl(input.webOrigin, input.unsubToken);

  const text = [
    `${input.challengerName} assumiu o #1 desta semana.`,
    "",
    `${input.dethronedName} nao esta mais no topo do ranking do Creator Outdoor.`,
    "",
    `Ver o ranking: ${profileUrl}`,
    "",
    "Voce esta recebendo este aviso porque pediu para acompanhar este perfil.",
    `Para parar de receber: ${unsubscribe}`,
  ].join("\n");

  return {
    to: input.to,
    subject: `${input.challengerName} assumiu o #1`,
    text,
    unsubscribeUrl: unsubscribe,
  };
}

export type WeeklyRecapEmailInput = {
  readonly to: string;
  readonly creatorName: string;
  readonly creatorSlug: string;
  readonly rank: number | null;
  readonly amountLabel: string;
  readonly supporterCount: number;
  readonly webOrigin: string;
  readonly unsubToken: string;
};

export function weeklyRecapEmail(input: WeeklyRecapEmailInput): EmailMessage {
  const profileUrl = new URL(`/criador/${input.creatorSlug}`, input.webOrigin).toString();
  const unsubscribe = unsubscribeUrl(input.webOrigin, input.unsubToken);
  const position = input.rank === null ? "sem impulsos nesta semana" : `#${input.rank}`;
  const people =
    input.supporterCount === 1
      ? "1 pessoa na torcida"
      : `${input.supporterCount} pessoas na torcida`;

  const text = [
    `A semana de ${input.creatorName} no Creator Outdoor: ${position}.`,
    "",
    `${input.amountLabel} impulsionados, ${people}.`,
    "",
    `Ver o perfil: ${profileUrl}`,
    "",
    "Voce esta recebendo este resumo porque pediu para acompanhar este perfil.",
    `Para parar de receber: ${unsubscribe}`,
  ].join("\n");

  return {
    to: input.to,
    subject: `${input.creatorName} nesta semana: ${position}`,
    text,
    unsubscribeUrl: unsubscribe,
  };
}
