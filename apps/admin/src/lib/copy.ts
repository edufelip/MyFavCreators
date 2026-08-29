/** Administrator-facing strings. Separate from the public product copy bank. */
export const adminCopy = {
  brand: "Creator Outdoor Admin",
  nav: {
    moderation: "Moderação",
    reports: "Denúncias",
    payments: "Pagamentos",
    audit: "Auditoria",
    signOut: "Sair",
  },
  login: {
    title: "Entrar",
    operatorLabel: "Operador",
    passwordLabel: "Senha",
    codeLabel: "Código do autenticador",
    codeHelp: "Os seis dígitos do seu aplicativo autenticador.",
    submit: "Entrar",
    // Deliberately one message for every kind of failure: which part was wrong
    // is exactly what somebody guessing would like to know.
    invalid: "Operador, senha ou código incorretos.",
    throttled: "Muitas tentativas. Aguarde alguns minutos.",
    /*
     * The one failure that says what went wrong, because the operator cannot
     * fix it by trying again. It is only ever shown to somebody who already
     * presented the published password and the published TOTP seed, so it
     * reveals nothing they could not read in the repository it came from.
     */
    publishedCredentials:
      "Estas credenciais são as de exemplo publicadas no repositório e não valem em produção. " +
      "Cadastre um operador real com: bun run admin:operator '<nome>' '<senha>'",
  },
  error: {
    title: "A ação não foi concluída",
    /*
     * Not "nothing was changed". A provider call is not inside a transaction
     * and cannot be, so a failure that reaches this page may have moved money —
     * and telling an operator otherwise, next to a retry button, is the worst
     * thing this page could say. The known cases now surface their own message
     * on the screen they happened on; this is for the ones that do not.
     */
    body: "Confira o estado antes de repetir. Se continuar, use a referência abaixo ao relatar.",
    retry: "Tentar de novo",
    back: "Voltar para a moderação",
    reference: (digest: string) => `Referência: ${digest}`,
  },
  payments: {
    title: "Pagamentos",
    empty: "Nenhum pagamento registrado.",
    columns: {
      created: "Criado em",
      creator: "Perfil",
      amount: "Valor",
      status: "Situação",
      boost: "Destaque",
      provider: "Provedor",
    },
    filterLabel: "Situação",
    all: "Todas",
    refund: "Estornar",
    refundReason: "Motivo do estorno",
    refundHelp:
      "O valor volta para quem pagou. Nenhum valor é repassado ao criador em nenhuma hipótese.",
    refundConfirm: "Confirmar estorno",
    refunded: "Estornado",
    notRefundable: "Só um pagamento confirmado pode ser estornado.",
  },
  moderation: {
    title: "Fila de moderação",
    empty: "Nenhum perfil aguardando análise.",
    checklist: {
      title: "Checklist de análise",
      items: [
        "É um criador público ou profissional?",
        "O perfil pertence ao criador representado?",
        "Não é claramente uma criança ou adolescente?",
        "A URL é válida e aponta para o perfil?",
        "Não é duplicado de um perfil já aprovado?",
        "Não é uma tentativa de se passar por outra pessoa?",
        "Não há conteúdo malicioso?",
        "Há metadados suficientes para publicar?",
      ],
    },
    approve: "Aprovar",
    reject: "Rejeitar",
    remove: "Remover",
    restore: "Restaurar",
    save: "Salvar metadados",
    rejectionReason: "Motivo da rejeição",
    note: "Observação (opcional)",
    displayName: "Nome de exibição",
    bio: "Bio",
    avatarUrl: "URL do avatar",
    category: "Categoria",
    status: "Situação",
    submittedAt: "Enviado em",
    links: "Links",
  },
  reports: {
    title: "Denúncias",
    empty: "Nenhuma denúncia aberta.",
    resolve: "Resolver",
  },
  audit: {
    title: "Registro de auditoria",
    empty: "Nenhum evento registrado.",
    actor: "Autor",
    action: "Ação",
    target: "Alvo",
    when: "Quando",
  },
  statusLabels: {
    PENDING_REVIEW: "Aguardando análise",
    APPROVED: "Aprovado",
    REJECTED: "Rejeitado",
    REMOVED: "Removido",
    OPTOUT_VERIFICATION_PENDING: "Remoção em verificação",
    OPTED_OUT: "Removido a pedido",
  },
  rejectionReasonLabels: {
    NOT_PUBLIC_OR_PROFESSIONAL: "Não é criador público ou profissional",
    MINOR: "Menor de idade",
    DUPLICATE: "Duplicado",
    MALICIOUS_URL: "URL maliciosa",
    IMPERSONATION: "Tentativa de se passar por outra pessoa",
    INVALID_PROFILE: "Perfil inválido",
    OTHER: "Outro",
  },
  boundary:
    "Este painel nunca acessa o banco de dados diretamente: toda leitura e mutação passa pela API.",
} as const;
