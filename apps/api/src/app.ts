import type { ProductConfig } from "@creator-outdoor/config";
import type { Database } from "@creator-outdoor/db";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { ConsoleEmailProvider } from "./email/console";
import type { EmailProvider } from "./email/provider";
import { ConsoleErrorTracker } from "./observability/console-tracker";
import { enterRequestId, log, resolveRequestId, withRequestId } from "./observability/logger";
import type { ErrorTracker } from "./observability/tracker";
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
import { categoryRoutes, rankingRoutes } from "./routes/rankings";
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
  /** Webhook signing secret for Resend email events. */
  readonly resendWebhookSecret?: string;
  readonly rateLimiter?: RateLimiter;
  /** Where unhandled failures are reported. Defaults to the log. */
  readonly errorTracker?: ErrorTracker;
};

/**
 * The authoritative HTTP surface.
 *
 * CORS narrows which browsers may read a response; it is not authorization.
 * Every endpoint still validates its own input and serializes through an
 * explicit allowlist.
 */
/**
 * The id of an in-flight request.
 *
 * A weak map keyed by the request itself, so nothing is left behind when the
 * request is collected and two concurrent requests cannot read each other's id.
 */
const REQUEST_IDS = new WeakMap<Request, string>();

function withRequestIdOf<TResult>(request: Request, work: () => TResult): TResult {
  const requestId = REQUEST_IDS.get(request);
  return requestId === undefined ? work() : withRequestId(requestId, work);
}

export function createApp(options: CreateAppOptions) {
  const rateLimiter = options.rateLimiter ?? new RateLimiter();
  const errorTracker = options.errorTracker ?? new ConsoleErrorTracker();
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
    /**
     * Every request gets an id, and every log line inside it carries that id.
     *
     * A payment, its webhook, the follow-ups it triggers and the failure three
     * layers down are otherwise unrelated lines in a log nobody can correlate.
     * An upstream `x-request-id` is honoured so a trace spans the whole hop,
     * and echoed back so a client can quote it in a bug report.
     */
    .onRequest(({ request, set }) => {
      const requestId = resolveRequestId(request.headers.get("x-request-id"));
      set.headers["x-request-id"] = requestId;
      REQUEST_IDS.set(request, requestId);
      enterRequestId(requestId);
    })
    .use(
      cors({
        origin: [...options.allowedOrigins],
        methods: ["GET", "POST", "OPTIONS"],
        credentials: false,
      }),
    )
    .onError(({ code, error, request, set }) => {
      const requestId = REQUEST_IDS.get(request);
      if (requestId !== undefined) {
        set.headers["x-request-id"] = requestId;
      }
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: { code: "BAD_REQUEST", message: "Requisição inválida." } };
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Recurso não encontrado." } };
      }
      // Never leak a driver message, a stack trace or an internal identifier.
      withRequestIdOf(request, () => log.error("api_error", error, { code }));
      /*
       * Reported as well as logged, and deliberately not awaited: a request
       * that already failed should not also wait on a third party to hear about
       * it. `capture` is written not to reject, and the `.catch` is here anyway
       * — an unhandled rejection inside an error handler is the worst place to
       * be relying on somebody else keeping a promise.
       */
      void errorTracker
        .capture({
          event: "api_error",
          error,
          ...(requestId === undefined ? {} : { requestId }),
          context: { code, method: request.method, route: new URL(request.url).pathname },
        })
        .catch(() => {
          // Nothing left to do about it here; the failure is already in the log.
        });
      set.status = 500;
      return { error: { code: "INTERNAL", message: "Erro interno." } };
    })
    .get("/health", () => ({ status: "ok" as const }))
    .use(categoryRoutes({ database: options.database }))
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
        ...(options.resendWebhookSecret === undefined
          ? {}
          : { resendWebhookSecret: options.resendWebhookSecret }),
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    )
    .use(
      adminRoutes({
        database: options.database,
        adminApiSecret: options.adminApiSecret,
        product: options.product,
        paymentProvider: provider,
        email,
        webOrigin,
        ...(options.now === undefined ? {} : { now: options.now }),
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
