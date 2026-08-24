import {
  AcknowledgementDto,
  AdminApproveRequestDto,
  AdminAuditLogListDto,
  AdminCreatorDto,
  AdminCreatorListDto,
  AdminRejectRequestDto,
  AdminRemoveRequestDto,
  AdminReportListDto,
  AdminUpdateCreatorRequestDto,
  ApiErrorDto,
  ModerationStatusSchema,
  Uuid,
} from "@creator-outdoor/contracts";
import {
  type Database,
  findCategoryIdBySlug,
  findCreatorById,
  listAuditLogs,
  listReports,
  resolveReport,
  updateCreatorMetadata,
  writeAuditLog,
} from "@creator-outdoor/db";
import { InvalidModerationTransitionError } from "@creator-outdoor/domain";
import { Elysia, t } from "elysia";
import { isAuthorizedAdminRequest } from "../../security/admin-auth";
import { serializeAdminCreator } from "../../serializers/creators";
import {
  approveCreator,
  CreatorNotFoundError,
  getModerationQueue,
  rejectCreator,
  removeCreator,
  restoreCreator,
} from "../../services/moderation";

export type AdminRouteDependencies = {
  readonly database: Database;
  readonly adminApiSecret: string;
};

const UNAUTHORIZED = {
  error: { code: "UNAUTHORIZED" as const, message: "Credencial administrativa inválida." },
};
const NOT_FOUND = {
  error: { code: "NOT_FOUND" as const, message: "Recurso não encontrado." },
};
const UNPROCESSABLE = (message: string) => ({
  error: { code: "UNPROCESSABLE" as const, message },
});

const creatorIdParams = t.Object({ id: Uuid });

/** The actor recorded in the audit log for every action on this surface. */
const ADMIN_ACTOR = "admin";

/**
 * The internal administration surface.
 *
 * Never exposed to a public client. apps/admin owns the administrator browser
 * session and calls these routes server-to-server with a shared secret that the
 * browser never receives. CORS does not protect this: authorization does, on
 * every single route, before any handler work happens.
 */
export function adminRoutes(dependencies: AdminRouteDependencies) {
  return new Elysia({ prefix: "/internal/admin" })
    .onBeforeHandle(({ request, status }) => {
      if (!isAuthorizedAdminRequest(request, dependencies.adminApiSecret)) {
        return status(401, UNAUTHORIZED);
      }
      return undefined;
    })
    .get(
      "/creators",
      async ({ query }) => {
        const { creators, total } = await getModerationQueue(
          dependencies.database,
          query.status ?? "PENDING_REVIEW",
          query.limit ?? 50,
          query.offset ?? 0,
        );
        return { creators: creators.map(serializeAdminCreator), total };
      },
      {
        query: t.Object({
          status: t.Optional(ModerationStatusSchema),
          limit: t.Optional(t.Integer({ minimum: 1, maximum: 200, default: 50 })),
          offset: t.Optional(t.Integer({ minimum: 0, maximum: 10_000, default: 0 })),
        }),
        response: { 200: AdminCreatorListDto, 401: ApiErrorDto },
      },
    )
    .get(
      "/creators/:id",
      async ({ params, status }) => {
        const creator = await findCreatorById(dependencies.database, params.id);
        return creator === null ? status(404, NOT_FOUND) : serializeAdminCreator(creator);
      },
      {
        params: creatorIdParams,
        response: { 200: AdminCreatorDto, 401: ApiErrorDto, 404: ApiErrorDto },
      },
    )
    .post(
      "/creators/:id/approve",
      async ({ params, body, status }) => {
        try {
          await approveCreator(dependencies.database, {
            creatorId: params.id,
            actor: ADMIN_ACTOR,
            displayName: body.displayName,
            bio: body.bio,
            avatarUrl: body.avatarUrl,
            categorySlug: body.categorySlug,
          });
          return { ok: true, message: "Criador aprovado." };
        } catch (error) {
          const failure = classifyModerationError(error);
          return failure.code === 404 ? status(404, failure.body) : status(422, failure.body);
        }
      },
      {
        params: creatorIdParams,
        body: AdminApproveRequestDto,
        response: {
          200: AcknowledgementDto,
          401: ApiErrorDto,
          404: ApiErrorDto,
          422: ApiErrorDto,
        },
      },
    )
    .post(
      "/creators/:id/reject",
      async ({ params, body, status }) => {
        try {
          await rejectCreator(dependencies.database, {
            creatorId: params.id,
            actor: ADMIN_ACTOR,
            reason: body.reason,
            note: body.note,
          });
          return { ok: true, message: "Criador rejeitado." };
        } catch (error) {
          const failure = classifyModerationError(error);
          return failure.code === 404 ? status(404, failure.body) : status(422, failure.body);
        }
      },
      {
        params: creatorIdParams,
        body: AdminRejectRequestDto,
        response: {
          200: AcknowledgementDto,
          401: ApiErrorDto,
          404: ApiErrorDto,
          422: ApiErrorDto,
        },
      },
    )
    .post(
      "/creators/:id/remove",
      async ({ params, body, status }) => {
        try {
          await removeCreator(dependencies.database, {
            creatorId: params.id,
            actor: ADMIN_ACTOR,
            note: body.note,
          });
          return { ok: true, message: "Criador removido." };
        } catch (error) {
          const failure = classifyModerationError(error);
          return failure.code === 404 ? status(404, failure.body) : status(422, failure.body);
        }
      },
      {
        params: creatorIdParams,
        body: AdminRemoveRequestDto,
        response: {
          200: AcknowledgementDto,
          401: ApiErrorDto,
          404: ApiErrorDto,
          422: ApiErrorDto,
        },
      },
    )
    .post(
      "/creators/:id/restore",
      async ({ params, status }) => {
        try {
          await restoreCreator(dependencies.database, {
            creatorId: params.id,
            actor: ADMIN_ACTOR,
          });
          return { ok: true, message: "Criador restaurado." };
        } catch (error) {
          const failure = classifyModerationError(error);
          return failure.code === 404 ? status(404, failure.body) : status(422, failure.body);
        }
      },
      {
        params: creatorIdParams,
        response: {
          200: AcknowledgementDto,
          401: ApiErrorDto,
          404: ApiErrorDto,
          422: ApiErrorDto,
        },
      },
    )
    .patch(
      "/creators/:id",
      async ({ params, body, status }) => {
        const creator = await findCreatorById(dependencies.database, params.id);
        if (creator === null) {
          return status(404, NOT_FOUND);
        }
        const categoryId =
          body.categorySlug === undefined
            ? undefined
            : ((await findCategoryIdBySlug(dependencies.database, body.categorySlug)) ?? undefined);
        if (body.categorySlug !== undefined && categoryId === undefined) {
          return status(422, UNPROCESSABLE("Categoria desconhecida."));
        }

        await updateCreatorMetadata(dependencies.database, {
          creatorId: params.id,
          ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
          ...(body.bio === undefined ? {} : { bio: body.bio }),
          ...(body.avatarUrl === undefined ? {} : { avatarUrl: body.avatarUrl }),
          ...(categoryId === undefined ? {} : { categoryId }),
        });
        await writeAuditLog(dependencies.database, {
          actor: ADMIN_ACTOR,
          action: "creator.metadata_updated",
          targetType: "creator",
          targetId: params.id,
          metadata: { fields: Object.keys(body) },
        });
        return { ok: true, message: "Metadados atualizados." };
      },
      {
        params: creatorIdParams,
        body: AdminUpdateCreatorRequestDto,
        response: {
          200: AcknowledgementDto,
          401: ApiErrorDto,
          404: ApiErrorDto,
          422: ApiErrorDto,
        },
      },
    )
    .get(
      "/reports",
      async ({ query }) => {
        const reports = await listReports(
          dependencies.database,
          query.status ?? "OPEN",
          query.limit ?? 50,
          query.offset ?? 0,
        );
        return {
          reports: reports.map((report) => ({
            id: report.id,
            creatorId: report.creatorId,
            creatorSlug: report.creatorSlug,
            reason: report.reason,
            details: report.details,
            status: report.status,
            createdAt: report.createdAt.toISOString(),
            resolvedAt: report.resolvedAt?.toISOString() ?? null,
          })),
        };
      },
      {
        query: t.Object({
          status: t.Optional(t.Union([t.Literal("OPEN"), t.Literal("RESOLVED")])),
          limit: t.Optional(t.Integer({ minimum: 1, maximum: 200, default: 50 })),
          offset: t.Optional(t.Integer({ minimum: 0, maximum: 10_000, default: 0 })),
        }),
        response: { 200: AdminReportListDto, 401: ApiErrorDto },
      },
    )
    .post(
      "/reports/:id/resolve",
      async ({ params, status }) => {
        const resolved = await resolveReport(dependencies.database, params.id);
        if (!resolved) {
          return status(404, NOT_FOUND);
        }
        await writeAuditLog(dependencies.database, {
          actor: ADMIN_ACTOR,
          action: "report.resolved",
          targetType: "report",
          targetId: params.id,
        });
        return { ok: true, message: "Denúncia resolvida." };
      },
      {
        params: t.Object({ id: Uuid }),
        response: { 200: AcknowledgementDto, 401: ApiErrorDto, 404: ApiErrorDto },
      },
    )
    .get(
      "/audit-logs",
      async ({ query }) => {
        const entries = await listAuditLogs(
          dependencies.database,
          query.limit ?? 100,
          query.offset ?? 0,
        );
        return {
          entries: entries.map((entry) => ({
            id: entry.id,
            actor: entry.actor,
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            metadata: entry.metadata,
            createdAt: entry.createdAt.toISOString(),
          })),
        };
      },
      {
        query: t.Object({
          limit: t.Optional(t.Integer({ minimum: 1, maximum: 500, default: 100 })),
          offset: t.Optional(t.Integer({ minimum: 0, maximum: 10_000, default: 0 })),
        }),
        response: { 200: AdminAuditLogListDto, 401: ApiErrorDto },
      },
    );
}

type ModerationFailure =
  | { readonly code: 404; readonly body: typeof NOT_FOUND }
  | { readonly code: 422; readonly body: ReturnType<typeof UNPROCESSABLE> };

/**
 * Maps a domain failure onto a status without leaking internals. Anything not
 * recognised here is a real fault and is rethrown for the error handler.
 */
function classifyModerationError(error: unknown): ModerationFailure {
  if (error instanceof CreatorNotFoundError) {
    return { code: 404, body: NOT_FOUND };
  }
  if (error instanceof InvalidModerationTransitionError) {
    return {
      code: 422,
      body: UNPROCESSABLE(`Transição inválida: ${error.from} → ${error.to}.`),
    };
  }
  throw error;
}
