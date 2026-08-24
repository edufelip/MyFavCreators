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
    skipToContent: "Ir para o conteúdo",
    ranking: "Ranking",
    submit: "Enviar perfil",
    hallOfFame: "Hall da Fama",
    rules: "Regras",
  },

  cta: {
    boost: "IMPULSIONAR",
    viewProfile: "VER PERFIL",
    /** The quote is calculated against the ranking at this moment. */
    takeFirstPlace: (amount: string) => `Assuma o #1 por ${amount}`,
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
    empty: "Nenhum perfil em destaque neste momento.",
    entitlement: (count: number) =>
      count === 1 ? "1 perfil no rodízio agora" : `${count} perfis no rodízio agora`,
  },

  ticker: {
    title: "Ultrapassagens",
    overtake: (handle: string, from: number, to: number, elapsed: string) =>
      `@${handle} subiu de #${from} para #${to} há ${elapsed}`,
    passed: (handle: string, passedHandle: string, elapsed: string) =>
      `@${handle} ultrapassou @${passedHandle} há ${elapsed}`,
    empty: "Nenhuma ultrapassagem ainda nesta semana.",
    justNow: "instantes",
  },

  champion: {
    previous: "Campeão da semana passada",
    badge: "Campeão da semana",
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

  boostForm: {
    title: "Impulsione um perfil",
    creatorLabel: "Perfil",
    amountLabel: "Valor",
    customAmount: "Outro valor",
    quickValues: "Valores rápidos",
    supporterName: "Seu nome (opcional)",
    supporterMessage: "Mensagem (opcional)",
    anonymous: "Impulsionar como Anônimo",
    email: "E-mail (opcional)",
    emailHint: "Usado só para o comprovante e para avisos que você pedir.",
    notifyOnDethrone: "Me avise se este perfil perder o topo",
    submit: "IMPULSIONAR",
    submitting: "Gerando PIX...",
    chooseCreator: "Escolha um perfil no ranking para impulsionar.",
    failed: "Não foi possível gerar o PIX agora. Tente novamente em instantes.",
  },

  checkout: {
    title: "Pague com PIX",
    scan: "Aponte a câmera do seu banco para o QR Code",
    copyPaste: "Ou use o PIX copia e cola",
    copy: "Copiar código",
    copied: "Código copiado",
    expiresAt: (time: string) => `O código expira em ${time}`,
    expired: "Este código PIX expirou. Gere um novo para impulsionar.",
    waiting: "Aguardando a confirmação do PIX...",
    waitingHint: "Assim que o banco confirmar, o ranking é atualizado.",
    failed: "O pagamento não foi concluído.",
    refunded: "Este pagamento foi estornado.",
    voided: "O impulso não foi ativado e o valor será devolvido.",
    backToRanking: "Voltar ao ranking",
  },

  success: {
    title: "Impulso confirmado",
    enteredRanking: (rank: number) => `Entrou no ranking em #${rank}`,
    share: "Compartilhar",
    shareCopied: "Texto copiado",
    seeProfile: "Ver perfil",
  },

  rules: {
    title: "Regras",
    updatedAt: "Estas regras valem para todos os impulsos no Creator Outdoor.",
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

  torcida: {
    title: "Torcida",
    subtitle: "Quem impulsionou este perfil.",
    weekly: "Nesta semana",
    allTime: "Total",
    empty: "Ninguém impulsionou este perfil ainda. Seja o primeiro.",
    anonymous: "Anônimo",
    boostCount: (count: number) => (count === 1 ? "1 impulso" : `${count} impulsos`),
    supporters: (count: number) =>
      count === 1 ? "1 pessoa na torcida" : `${count} pessoas na torcida`,
    more: (count: number) => `e mais ${count}`,
  },

  claim: {
    title: "Este perfil é meu",
    intro:
      "Para gerenciar este perfil, prove que ele é seu: geramos um código, você coloca na bio e confirma aqui.",
    request: "Gerar código",
    stepOne: "1. Gere seu código",
    stepTwo: "2. Confirme com o código no perfil",
    profileTextLabel: "Cole aqui a bio ou descrição do perfil com o código",
    emailLabel: "Email para avisos (opcional)",
    verify: "Confirmar e gerenciar",
    outcomes: {
      VERIFIED: "Perfil reivindicado.",
      CODE_NOT_FOUND: "Não encontramos o código no texto enviado. Confira e tente de novo.",
      EXPIRED: "O código expirou. Gere um novo e tente de novo.",
      NO_OPEN_REQUEST: "Não há pedido aberto para este perfil.",
    },
  },

  manage: {
    title: "Gerenciar perfil",
    signedOut: "Sua sessão de gerenciamento terminou. Reivindique o perfil de novo.",
    unavailable: "Não foi possível salvar agora. Tente novamente em instantes.",
    saved: "Salvo.",
    bio: "Bio",
    category: "Categoria",
    save: "Salvar",
    signOut: "Sair",
    delivery: "Entrega medida",
    impressions: "Exibições",
    clicks: "Cliques para o perfil",
    ctr: "Taxa de clique",
    ctrUnavailable: "sem exibições ainda",
    ranking: "Ranking",
    weeklyRank: "Posição desta semana",
    weeklyTotal: "Nesta semana",
    lifetimeTotal: "Total acumulado",
    supporters: "Impulsionadores",
    championWeeks: "Semanas em #1",
    notifications: "Avisos",
    notifyDethrone: "Quero saber quando alguém assumir o #1",
    notifyEmail: "Email para avisos",
    embed: "Selo para o seu site",
    embedHelp: "Cole este código onde quiser mostrar sua posição.",
    noSession: "Nenhum perfil reivindicado neste navegador.",
    findProfile: "Ver o ranking",
  },

  hallOfFame: {
    title: "Hall da Fama",
    subtitle: "Quem terminou a semana em #1.",
    empty: "Nenhuma semana fechou ainda.",
    week: "Semana de",
    championBadge: (weeks: number) => (weeks === 1 ? "1 semana em #1" : `${weeks} semanas em #1`),
  },

  unsubscribe: {
    title: "Avisos deste perfil",
    body: "Você não vai mais receber avisos deste perfil. Nada mais muda: os impulsos já feitos continuam valendo.",
    confirm: "Cancelar os avisos",
    intro: "Confirme para parar de receber avisos sobre este perfil.",
    backToRanking: "Ver o ranking",
    unavailable: "Não foi possível cancelar agora. Tente novamente em instantes.",
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
