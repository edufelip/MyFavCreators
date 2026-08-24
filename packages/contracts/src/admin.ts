import { type Static, Type as t } from "@sinclair/typebox";
import { CategoryDto } from "./creator";
import { CreatorLinkDto } from "./creators-detail";
import { ClaimStatusSchema, ModerationStatusSchema, RejectionReasonSchema } from "./enums";
import { IsoDateTime, Slug, Uuid } from "./primitives";

/**
 * Administration payloads.
 *
 * These are served only from `/internal/admin/*`, reached server-to-server from
 * apps/admin. They may carry moderation metadata that public DTOs never do, but
 * they still never carry supporter identities or payment secrets.
 */
export const AdminCreatorDto = t.Object(
  {
    id: Uuid,
    slug: Slug,
    displayName: t.String({ maxLength: 120 }),
    bio: t.Union([t.String({ maxLength: 500 }), t.Null()]),
    avatarUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]),
    category: CategoryDto,
    claimStatus: ClaimStatusSchema,
    moderationStatus: ModerationStatusSchema,
    rejectionReason: t.Union([RejectionReasonSchema, t.Null()]),
    links: t.Array(CreatorLinkDto),
    createdAt: IsoDateTime,
  },
  { $id: "AdminCreator" },
);
export type AdminCreatorDto = Static<typeof AdminCreatorDto>;

export const AdminCreatorListDto = t.Object(
  {
    creators: t.Array(AdminCreatorDto),
    total: t.Integer({ minimum: 0 }),
  },
  { $id: "AdminCreatorList" },
);
export type AdminCreatorListDto = Static<typeof AdminCreatorListDto>;

export const AdminApproveRequestDto = t.Object(
  {
    displayName: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    bio: t.Optional(t.String({ maxLength: 500 })),
    avatarUrl: t.Optional(t.String({ maxLength: 2048 })),
    categorySlug: t.Optional(Slug),
  },
  { $id: "AdminApproveRequest" },
);
export type AdminApproveRequestDto = Static<typeof AdminApproveRequestDto>;

export const AdminRejectRequestDto = t.Object(
  {
    reason: RejectionReasonSchema,
    note: t.Optional(t.String({ maxLength: 500 })),
  },
  { $id: "AdminRejectRequest" },
);
export type AdminRejectRequestDto = Static<typeof AdminRejectRequestDto>;

export const AdminRemoveRequestDto = t.Object(
  { note: t.Optional(t.String({ maxLength: 500 })) },
  { $id: "AdminRemoveRequest" },
);
export type AdminRemoveRequestDto = Static<typeof AdminRemoveRequestDto>;

export const AdminUpdateCreatorRequestDto = t.Object(
  {
    displayName: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    bio: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
    avatarUrl: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
    categorySlug: t.Optional(Slug),
  },
  { $id: "AdminUpdateCreatorRequest" },
);
export type AdminUpdateCreatorRequestDto = Static<typeof AdminUpdateCreatorRequestDto>;

export const AdminReportDto = t.Object(
  {
    id: Uuid,
    creatorId: Uuid,
    creatorSlug: Slug,
    reason: t.String({ maxLength: 80 }),
    details: t.Union([t.String({ maxLength: 1000 }), t.Null()]),
    status: t.Union([t.Literal("OPEN"), t.Literal("RESOLVED")]),
    createdAt: IsoDateTime,
    resolvedAt: t.Union([IsoDateTime, t.Null()]),
  },
  { $id: "AdminReport" },
);
export type AdminReportDto = Static<typeof AdminReportDto>;

export const AdminReportListDto = t.Object(
  { reports: t.Array(AdminReportDto) },
  { $id: "AdminReportList" },
);
export type AdminReportListDto = Static<typeof AdminReportListDto>;

export const AdminAuditLogDto = t.Object(
  {
    id: Uuid,
    actor: t.String({ maxLength: 120 }),
    action: t.String({ maxLength: 120 }),
    targetType: t.String({ maxLength: 60 }),
    targetId: t.String({ maxLength: 120 }),
    metadata: t.Unknown(),
    createdAt: IsoDateTime,
  },
  { $id: "AdminAuditLog" },
);
export type AdminAuditLogDto = Static<typeof AdminAuditLogDto>;

export const AdminAuditLogListDto = t.Object(
  { entries: t.Array(AdminAuditLogDto) },
  { $id: "AdminAuditLogList" },
);
export type AdminAuditLogListDto = Static<typeof AdminAuditLogListDto>;
