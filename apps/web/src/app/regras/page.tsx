import { webConfig } from "@creator-outdoor/config/web";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BoostDisclosure } from "@/components/boost-disclosure";
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
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
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
          {copy.rotation.title}” por {product.rotationHours} horas, permite deixar nome e recado no
          mural e gera um resultado com o movimento real de posição.
        </p>
      </Rule>

      <Rule title="Nenhum valor vai para o criador">
        <p>
          O Creator Outdoor não é vaquinha, não é doação e não é apoio financeiro a criadores.
          Nenhum valor é repassado ao criador impulsionado. Todo o valor é da plataforma,
          descontadas taxas de pagamento, impostos, estornos e despesas operacionais.
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
          O valor cobrado é exatamente o valor mostrado. A plataforma nunca cobra um segundo valor,
          nunca reserva o primeiro lugar e nunca congela o ranking.
        </p>
      </Rule>

      <Rule title="O que a plataforma não promete">
        <p>
          O Creator Outdoor garante a mecânica do produto, nunca o comportamento do público. Não há
          promessa de posição final, de número de exibições, de cliques, de seguidores ou de
          qualquer engajamento fora da plataforma.
        </p>
        <p>
          O direito ao rodízio significa participar do sorteio de exibição entre os perfis elegíveis
          durante o período. Não significa aparecer sem parar por {product.rotationHours} horas.
        </p>
      </Rule>

      <Rule title="Moderação">
        <p>
          Todo perfil enviado passa por análise humana antes de aparecer publicamente. Perfis podem
          ser recusados por não serem de criador público ou profissional, por parecerem de menor de
          idade, por duplicidade, por link malicioso, por tentativa de se passar por outra pessoa ou
          por dados insuficientes.
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
        <p>TODO(legal): política de reembolso e prazo de arrependimento a revisar juridicamente.</p>
      </Rule>

      <Rule title="Reivindicação de perfil">
        <p>
          Criadores poderão reivindicar o próprio perfil com o mesmo código de verificação.
          Reivindicar o perfil não gera nenhum pagamento ao criador.
        </p>
      </Rule>

      <Rule title="Contato">
        <p>TODO(legal): endereço de contato oficial.</p>
        <p>TODO(legal): razão social, CNPJ e endereço da empresa responsável.</p>
      </Rule>
    </main>
  );
}
