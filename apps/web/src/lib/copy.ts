/**
 * Every public product string lives here.
 *
 * Creator Outdoor sells display space, prominence and measurable visibility. It
 * is not crowdfunding, donations, tipping or financial support for creators, so
 * this file must never contain wording that implies money reaches a creator
 * (apoie, apoio, doe, doação, vaquinha, contribuição, gorjeta, repasse, support,
 * donate, tip, fund) or gambling wording (sorteio, concorra, prêmio em dinheiro,
 * chance de ganhar).
 */
const AMOUNT_SUFFIX = {
  weekly: "impulsionados esta semana",
  allTime: "impulsionados no total",
} as const;

export const copy = {
  brand: {
    name: "Creator Outdoor",
    tagline: "O outdoor das torcidas.",
  },

  hero: {
    headline: "O outdoor das torcidas.",
    subheadline: "Impulsione um perfil. Compre destaque. Dispute o topo.",
  },

  nav: {
    ranking: "Ranking",
  },

  cta: {
    boost: "IMPULSIONAR",
    viewProfile: "VER PERFIL",
    /** The quote is calculated against the ranking at this moment. */
    takeFirstPlace: (amount: string) => `Assuma o #1 por ${amount}`,
    comingSoon: "Em breve",
  },

  /**
   * The mandatory disclosure. Rendered verbatim and never hidden, collapsed,
   * placed behind a tooltip or reduced to unreadable fine print.
   */
  disclosure: "Você está comprando destaque nesta plataforma. Nenhum valor é repassado ao criador.",

  /** Shown whenever checkout originated from the Assuma o #1 call to action. */
  rankQuoteDisclosure:
    "Valor calculado com base no ranking atual. A posição pode mudar antes da confirmação do PIX.",

  billboard: {
    eyebrow: "#1 desta semana",
    previousChampion: "Campeão da semana passada",
  },

  leaderboard: {
    title: "Ranking",
    weeklyTab: "Esta semana",
    allTimeTab: "Geral",
    amountSuffix: AMOUNT_SUFFIX,
    weeklyAmount: (amount: string) => `${amount} ${AMOUNT_SUFFIX.weekly}`,
    allTimeAmount: (amount: string) => `${amount} ${AMOUNT_SUFFIX.allTime}`,
    supporters: (count: number) =>
      count === 1
        ? "1 impulsionador"
        : `${new Intl.NumberFormat("pt-BR").format(count)} impulsionadores`,
    empty: "Nenhum perfil impulsionado ainda nesta semana.",
    unavailable: "O ranking está indisponível no momento. Tente novamente em instantes.",
  },

  rotation: {
    title: "Impulsionados agora",
  },

  countdown: {
    label: (time: string) => `O ranking semanal zera em ${time}`,
  },

  fanRanking: {
    title: (handle: string) => `Torcida de @${handle}`,
    topFanBadge: "Maior fã da semana",
  },

  creator: {
    unclaimed: "É você? Reivindique ou solicite a remoção desta página.",
    emailOptIn: (handle: string) => `Me avise se @${handle} perder o topo`,
  },

  boost: {
    success: (handle: string, amount: string, from: number, to: number) =>
      `🎉 Você impulsionou @${handle} com ${amount} - #${from} -> #${to}`,
    share: (handle: string, from: number, to: number) =>
      `Eu impulsionei @${handle}. #${from} -> #${to} 🔥 Quem leva ao #1?`,
  },

  notifications: {
    dethroneSubject: (handle: string, takeAmount: string) =>
      `@${handle} caiu para #2 - ${takeAmount} retoma o topo`,
  },

  heatMode: {
    label: "DECIDE HOJE",
  },
} as const;
