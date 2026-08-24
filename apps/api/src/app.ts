import type { ProductConfig } from "@creator-outdoor/config";
import type { Database } from "@creator-outdoor/db";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { ConsoleEmailProvider } from "./email/console";
import type { EmailProvider } from "./email/provider";
import { describeErrorMessage } from "./observability/errors";
import { FakePixPaymentProvider } from "./payments/fake-pix";
import type { PixPaymentProvider } from "./payments/provider";
import { analyticsRoutes } from "./routes/analytics";
import { boostRoutes } from "./routes/boosts";
import { claimRoutes } from "./routes/claims";
import { creatorRoutes } from "./routes/creators";
import { devPixRoutes } from "./routes/dev-pix";
import { adminRoutes } from "./routes/internal/admin";
import { liveRoutes } from "./routes/live";
import { notificationRoutes } from "./routes/notifications";
import { rankingRoutes } from "./routes/rankings";
import { webhookRoutes } from "./routes/webhooks";
import { RateLimiter } from "./security/rate-limit";

export type CreateAppOptions = {
  readonly database: Database;
  readonly product: ProductConfig;
  /** Explicit allowlist. Sensitive API surfaces never answer `*`. */
  readonly allowedOrigins: readonly string[];
  /** Server-only shared secret for the internal admin surface. */
  readonly adminApiSecret: string;
  /** Server-only secret that derives supporter grouping keys. */
  readonly fanIdentitySecret: string;
  /** The provider that creates payments. Defaults to the fake PIX provider. */
  readonly paymentProvider?: PixPaymentProvider;
  /** The provider that sends notifications. Defaults to the console provider. */
  readonly emailProvider?: EmailProvider;
  /** Where an unsubscribe link points. The public site, never this API. */
  readonly webOrigin?: string;
  /**
   * Enables the development-only PIX simulation routes. Never true in
   * production: the guard lives here rather than in the route, so a route file
   * cannot accidentally be mounted by a future refactor.
   */
  readonly enableDevPixSimulation?: boolean;
  readonly selfOrigin?: string;
  readonly now?: () => Date;
  readonly rateLimiter?: RateLimiter;
};

/**
 * The authoritative HTTP surface.
 *
 * CORS narrows which browsers may read a response; it is not authorization.
 * Every endpoint still validates its own input and serializes through an
 * explicit allowlist.
 */
export function createApp(options: CreateAppOptions) {
  const rateLimiter = options.rateLimiter ?? new RateLimiter();
  const email = options.emailProvider ?? new ConsoleEmailProvider();
  const webOrigin = options.webOrigin ?? options.allowedOrigins[0] ?? "http://localhost:3000";
  const provider =
    options.paymentProvider ??
    new FakePixPaymentProvider({
      expirationMinutes: options.product.fakePixExpirationMinutes,
      signingSecret: options.fanIdentitySecret,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  const providers = new Map<string, PixPaymentProvider>([[provider.name, provider]]);
  const selfOrigin = options.selfOrigin ?? "http://localhost:3001";

  const app = new Elysia()
    .use(
      cors({
        origin: [...options.allowedOrigins],
        methods: ["GET", "POST", "OPTIONS"],
        credentials: false,
      }),
    )
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: { code: "BAD_REQUEST", message: "Requisição inválida." } };
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Recurso não encontrado." } };
      }
      // Never leak a driver message, a stack trace or an internal identifier.
      console.error("api_error", {
        code,
        message: describeErrorMessage(error),
      });
      set.status = 500;
      return { error: { code: "INTERNAL", message: "Erro interno." } };
    })
    .get("/health", () => ({ status: "ok" as const }))
    .use(
      rankingRoutes({
        database: options.database,
        product: options.product,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      creatorRoutes({
        database: options.database,
        product: options.product,
        rateLimiter,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      analyticsRoutes({
        database: options.database,
        product: options.product,
        rateLimiter,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      liveRoutes({
        database: options.database,
        product: options.product,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      claimRoutes({
        database: options.database,
        product: options.product,
        rateLimiter,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      notificationRoutes({
        database: options.database,
        product: options.product,
        rateLimiter,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      boostRoutes({
        database: options.database,
        product: options.product,
        provider,
        fanIdentitySecret: options.fanIdentitySecret,
        rateLimiter,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      webhookRoutes({
        database: options.database,
        product: options.product,
        providers,
        email,
        webOrigin,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      adminRoutes({
        database: options.database,
        adminApiSecret: options.adminApiSecret,
      }),
    );

  if (options.enableDevPixSimulation === true && provider instanceof FakePixPaymentProvider) {
    return app.use(
      devPixRoutes({
        provider,
        database: options.database,
        webhookUrl: new URL(`/v1/webhooks/payments/${provider.name}`, selfOrigin).toString(),
      }),
    );
  }
  return app;
}

export type App = ReturnType<typeof createApp>;
