import type { ProductConfig } from "@creator-outdoor/config";
import type { Database } from "@creator-outdoor/db";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { rankingRoutes } from "./routes/rankings";

export type CreateAppOptions = {
  readonly database: Database;
  readonly product: ProductConfig;
  /** Explicit allowlist. Sensitive API surfaces never answer `*`. */
  readonly allowedOrigins: readonly string[];
  readonly now?: () => Date;
};

/**
 * The authoritative HTTP surface.
 *
 * CORS narrows which browsers may read a response; it is not authorization.
 * Every endpoint still validates its own input and serializes through an
 * explicit allowlist.
 */
export function createApp(options: CreateAppOptions) {
  return new Elysia()
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
        message: error instanceof Error ? error.message : "unknown",
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
    );
}

export type App = ReturnType<typeof createApp>;
