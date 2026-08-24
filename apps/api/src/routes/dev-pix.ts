import { PaymentStatusSchema, Uuid } from "@creator-outdoor/contracts";
import { type Database, findPaymentByIdWithBoost } from "@creator-outdoor/db";
import { Elysia, t } from "elysia";
import { FAKE_PIX_SIGNATURE_HEADER, type FakePixPaymentProvider } from "../payments/fake-pix";

export type DevPixRouteDependencies = {
  readonly provider: FakePixPaymentProvider;
  readonly webhookUrl: string;
  readonly database: Database;
};

/**
 * Development-only simulation of a PIX provider's back office.
 *
 * Mounted **only** when the process is not in production; see `createApp`. It
 * moves a simulated payment and then delivers a properly signed webhook to the
 * real webhook route, so the development flow exercises the same authentication
 * and the same idempotency the production one will.
 */
export function devPixRoutes(dependencies: DevPixRouteDependencies) {
  return new Elysia({ prefix: "/dev/pix" })
    .get(
      "/lookup/:paymentId",
      async ({ params, status }) => {
        const payment = await findPaymentByIdWithBoost(dependencies.database, params.paymentId);
        return payment === null
          ? status(404, { found: false as const })
          : { found: true as const, providerPaymentId: payment.providerPaymentId };
      },
      {
        params: t.Object({ paymentId: Uuid }),
        response: {
          200: t.Object({ found: t.Literal(true), providerPaymentId: t.String() }),
          404: t.Object({ found: t.Literal(false) }),
        },
      },
    )
    .post(
      "/:providerPaymentId/:status",
      async ({ params, status }) => {
        try {
          dependencies.provider.simulate(params.providerPaymentId, params.status);
        } catch {
          return status(404, { simulated: false as const });
        }

        const body = JSON.stringify({
          eventId: `sim_${params.providerPaymentId}_${params.status}`,
          providerPaymentId: params.providerPaymentId,
          status: params.status,
        });
        const response = await fetch(dependencies.webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [FAKE_PIX_SIGNATURE_HEADER]: dependencies.provider.sign(body),
          },
          body,
        });

        return { simulated: true as const, webhookStatus: response.status };
      },
      {
        params: t.Object({
          providerPaymentId: t.String({ maxLength: 120 }),
          status: PaymentStatusSchema,
        }),
        response: {
          200: t.Object({ simulated: t.Literal(true), webhookStatus: t.Integer() }),
          404: t.Object({ simulated: t.Literal(false) }),
        },
      },
    );
}
