import { webConfig } from "@creator-outdoor/config/web";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BoostDisclosure } from "@/components/boost-disclosure";
import { SiteHeader } from "@/components/site-header";
import { copy } from "@/lib/copy";
import { formatBrl } from "@/lib/format";

export const metadata: Metadata = {
  title: copy.rules.title,
  description: copy.disclosure,
  alternates: { canonical: "/regras" },
};

function Rule({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-bold text-white">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-white/70">{children}</div>
    </section>
  );
}

/**
 * The public rules.
 *
 * Written to describe mechanics the platform actually guarantees, and never to
 * state a legal conclusion the product has not had reviewed. Where professional
 * review is required, the text says so rather than inventing an answer.
 */
export default function RulesPage() {
  const product = webConfig.product;

  return (
    <>
      <SiteHeader periodEndsAt={null} countdownLabel={null} />
      <main id="conteudo" className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-black tracking-tight text-white">{copy.rules.title}</h1>
          <p className="text-sm text-white/60">{copy.rules.updatedAt}</p>
          {/* Mandatory on the public rules page. */}
          <BoostDisclosure />
        </header>

        <Rule title="O que um impulso compra">
          <p>
            Um impulso compra destaque no Creator Outdoor. O valor entra na pontuação do perfil na
            semana atual e no ranking geral, dá direito de participar do rodízio “
            {copy.rotation.title}” por {product.rotationHours} horas, permite deixar nome e recado
            no mural e gera um resultado com o movimento real de posição.
          </p>
        </Rule>

        <Rule title="Nenhum valor vai para o criador">
          <p>
            O Creator Outdoor não é vaquinha, não é doação e não é apoio financeiro a criadores.
            Nenhum valor é repassado ao criador impulsionado. Todo o valor é da plataforma,
            descontadas taxas de pagamento, impostos, estornos e despesas operacionais.
          </p>
          <p>
            Impulsionar também nunca entra em sorteio, rifa ou prêmio de qualquer tipo. O que um
            impulso compra está descrito acima e é tudo o que ele compra.
          </p>
        </Rule>

        <Rule title="Como o ranking é calculado">
          <p>
            Dinheiro é o único critério. A pontuação é a soma dos impulsos ativos com pagamento
            confirmado. Não existe algoritmo secreto e nenhuma outra métrica influencia a posição.
          </p>
          <p>
            Empate é resolvido por quem chegou primeiro àquela pontuação e, se ainda houver empate,
            por quem entrou antes no Creator Outdoor.
          </p>
        </Rule>

        <Rule title="Exibições e cliques não mudam o ranking">
          <p>
            Exibições, cliques, CTR, seguidores, inscritos, curtidas, comentários, visualizações e
            qualquer engajamento fora da plataforma não afetam a posição de ninguém.
          </p>
        </Rule>

        <Rule title="A semana zera toda segunda-feira">
          <p>
            O ranking semanal vai de segunda-feira 00:00 à segunda seguinte 00:00, no horário de
            Brasília. O ranking geral continua somando todos os impulsos ativos.
          </p>
        </Rule>

        <Rule title={copy.cta.takeFirstPlace("R$X")}>
          <p>
            O valor mostrado é calculado com base no ranking naquele momento: a diferença para o
            primeiro lugar mais {formatBrl(product.minIncrementCents)}, respeitando o mínimo de{" "}
            {formatBrl(product.minBoostCents)}.
          </p>
          <p>{copy.rankQuoteDisclosure}</p>
          <p>
            O valor cobrado é exatamente o valor mostrado. A plataforma nunca cobra um segundo
            valor, nunca reserva o primeiro lugar e nunca congela o ranking.
          </p>
        </Rule>

        <Rule title="O que a plataforma não promete">
          <p>
            O Creator Outdoor garante a mecânica do produto, nunca o comportamento do público. Não
            há promessa de posição final, de número de exibições, de cliques, de seguidores ou de
            qualquer engajamento fora da plataforma.
          </p>
          <p>
            O direito ao rodízio significa entrar no grupo de perfis elegíveis durante o período.
            Quem aparece a cada momento é decidido por um cálculo fixo, igual para todos e sem acaso
            — não é uma disputa de sorte e não pode ser comprado. Entrar no grupo não significa
            aparecer sem parar por {product.rotationHours} horas.
          </p>
        </Rule>

        <Rule title="Moderação">
          <p>
            Todo perfil enviado passa por análise humana antes de aparecer publicamente. Perfis
            podem ser recusados por não serem de criador público ou profissional, por parecerem de
            menor de idade, por duplicidade, por link malicioso, por tentativa de se passar por
            outra pessoa ou por dados insuficientes.
          </p>
        </Rule>

        <Rule title="Remoção de um perfil">
          <p>
            Quem controla o perfil pode pedir a remoção. Para confirmar, a plataforma gera um código
            que precisa aparecer na bio ou descrição do perfil. Só depois dessa confirmação o perfil
            sai do Creator Outdoor — um pedido sozinho não muda nada, justamente para ninguém poder
            esconder o perfil de outra pessoa.
          </p>
          <p>Depois da remoção confirmada, o perfil não pode ser reenviado.</p>
        </Rule>

        <Rule title="Estornos">
          <p>
            Um impulso estornado deixa de contar imediatamente, na semana atual e no ranking geral,
            inclusive em semanas já encerradas.
          </p>
          <p>
            TODO(legal): política de reembolso e prazo de arrependimento a revisar juridicamente.
          </p>
        </Rule>

        <Rule title="Reivindicação de perfil">
          <p>
            Quem controla o perfil pode reivindicá-lo com o mesmo código de verificação usado na
            remoção. Depois de confirmado, o criador pode editar a bio e a categoria do próprio
            perfil, ver as exibições e cliques medidos pela plataforma e escolher receber avisos.
          </p>
          <p>
            O nome e os links do perfil não são editáveis, porque são exatamente o que identifica um
            perfil para quem visita. Reivindicar um perfil não gera nenhum pagamento ao criador.
          </p>
        </Rule>

        <Rule title="Mural da torcida">
          <p>
            Quem impulsiona pode deixar um nome e um recado curto, que aparecem no mural do perfil.
            É possível impulsionar de forma anônima: nesse caso o valor conta normalmente e o mural
            mostra apenas “Anônimo”, sem nome.
          </p>
          <p>
            O email deixado no checkout nunca aparece publicamente e serve só para avisos e recibo.
          </p>
        </Rule>

        <Rule title="Exibições, cliques e o selo">
          <p>
            A plataforma mede exibições e cliques para o perfil e mostra esses números ao criador
            reivindicado. A contagem é por sessão e por hora, então recarregar a página não infla
            nada. Nenhum desses números influencia o ranking.
          </p>
          <p>
            Todo link para o perfil passa por um redirecionamento da própria plataforma, para que o
            clique possa ser contado. O destino é sempre o link cadastrado, nunca um endereço vindo
            do pedido.
          </p>
          <p>
            Um perfil reivindicado recebe um selo em imagem para usar onde quiser. O selo mostra a
            posição da semana e o valor impulsionado, e não executa nenhum código na página de quem
            o usa.
          </p>
        </Rule>

        <Rule title="Avisos por email">
          <p>
            Quem deixa um email ao impulsionar passa a receber um aviso quando o perfil que
            acompanha perde o primeiro lugar, e um resumo semanal. Todo aviso traz um link de
            cancelamento de um clique, e cancelar vale para todos os avisos seguintes daquele
            perfil.
          </p>
        </Rule>

        <Rule title="Hall da Fama">
          <p>
            O Hall da Fama lista quem terminou cada semana em primeiro lugar. Como um estorno faz o
            valor deixar de contar, uma semana já encerrada pode ser recalculada e o campeão daquela
            semana pode mudar.
          </p>
        </Rule>

        <Rule title="Contato">
          <p>TODO(legal): endereço de contato oficial.</p>
          <p>TODO(legal): razão social, CNPJ e endereço da empresa responsável.</p>
        </Rule>
      </main>
    </>
  );
}
