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
    submit: "Enviar perfil",
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

  submission: {
    title: "Enviar um perfil",
    intro:
      "Cole o link do perfil do criador. Depois da análise, ele entra no ranking e pode ser impulsionado.",
    urlLabel: "Link do perfil",
    urlPlaceholder: "https://instagram.com/perfil",
    urlHint: "Instagram, TikTok, YouTube, Twitch, X, Spotify, Substack ou site próprio.",
    submit: "Enviar para análise",
    submitting: "Enviando...",
    outcomes: {
      SUBMITTED: "Perfil enviado para análise. Ele aparece no ranking depois da aprovação.",
      ALREADY_EXISTS: "Esse perfil já está no ranking.",
      ALREADY_PENDING: "Esse perfil já foi enviado e está em análise.",
      SUPPRESSED: "Este perfil pediu a remoção do Creator Outdoor e não pode ser reenviado.",
      INVALID_URL: "Não reconhecemos esse endereço.",
    },
    seeProfile: "Ver perfil",
    unavailable: "Não foi possível enviar agora. Tente novamente em instantes.",
  },

  creatorPage: {
    weeklyRank: "Posição desta semana",
    unranked: "Sem impulsos nesta semana",
    weeklyTotal: "Nesta semana",
    lifetimeTotal: "Total acumulado",
    supporters: "Impulsionadores",
    links: "Links",
    notFound: "Perfil não encontrado.",
    backToRanking: "Ver o ranking",
  },

  optOut: {
    title: "Reivindicar ou remover este perfil",
    intro:
      "Se este perfil é seu, você pode pedir a remoção. Para confirmar que o perfil é seu, geramos um código.",
    request: "Pedir remoção",
    stepOne: "1. Gere seu código",
    stepTwo: "2. Confirme com o código no perfil",
    codeTitle: "Seu código de verificação",
    profileTextLabel: "Cole aqui a bio ou descrição do perfil com o código",
    verify: "Confirmar remoção",
    outcomes: {
      VERIFIED: "Perfil removido do Creator Outdoor.",
      CODE_NOT_FOUND: "Não encontramos o código no texto enviado. Confira e tente de novo.",
      NO_OPEN_REQUEST: "Não há pedido de remoção aberto para este perfil.",
      EXPIRED: "O código expirou. Peça a remoção novamente para receber um novo código.",
    },
  },

  report: {
    title: "Denunciar este perfil",
    reasonLabel: "Motivo",
    detailsLabel: "Detalhes (opcional)",
    submit: "Enviar denúncia",
    sent: "Denúncia registrada. Obrigado.",
    reasons: {
      IMPERSONATION: "Está se passando por outra pessoa",
      NOT_A_PUBLIC_CREATOR: "Não é um criador público",
      MINOR: "É uma criança ou adolescente",
      MALICIOUS_OR_HARMFUL: "Conteúdo malicioso ou nocivo",
      WRONG_INFORMATION: "Informação incorreta",
      OTHER: "Outro",
    },
  },
} as const;
