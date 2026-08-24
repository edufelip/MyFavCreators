import type { RejectionReason } from "@creator-outdoor/domain";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import type { VerificationPurpose } from "../schema";
import { auditLogs, creators, creatorVerifications, reports } from "../schema";

export type ReportRecord = {
  readonly id: string;
  readonly creatorId: string;
  readonly creatorSlug: string;
  readonly reason: string;
  readonly details: string | null;
  readonly status: "OPEN" | "RESOLVED";
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
};

export async function insertReport(
  executor: DatabaseExecutor,
  input: {
    readonly creatorId: string;
    readonly reason: string;
    readonly details: string | null;
  },
): Promise<{ readonly id: string }> {
  const rows = await executor
    .insert(reports)
    .values({ creatorId: input.creatorId, reason: input.reason, details: input.details })
    .returning({ id: reports.id });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Failed to insert report");
  }
  return row;
}

export async function listReports(
  executor: DatabaseExecutor,
  status: "OPEN" | "RESOLVED",
  limit: number,
  offset: number,
): Promise<readonly ReportRecord[]> {
  const rows = await executor
    .select({
      id: reports.id,
      creatorId: reports.creatorId,
      creatorSlug: creators.slug,
      reason: reports.reason,
      details: reports.details,
      status: reports.status,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
    })
    .from(reports)
    .innerJoin(creators, eq(creators.id, reports.creatorId))
    .where(eq(reports.status, status))
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

export async function resolveReport(
  executor: DatabaseExecutor,
  reportId: string,
): Promise<boolean> {
  const rows = await executor
    .update(reports)
    .set({ status: "RESOLVED", resolvedAt: new Date() })
    .where(and(eq(reports.id, reportId), eq(reports.status, "OPEN")))
    .returning({ id: reports.id });
  return rows.length > 0;
}

export type AuditLogRecord = {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: unknown;
  readonly createdAt: Date;
};

/**
 * Records who did what to which creator.
 *
 * Written inside the same transaction as the change it describes, so an audit
 * entry can never disappear while its effect survives.
 */
export async function writeAuditLog(
  executor: DatabaseExecutor,
  input: {
    readonly actor: string;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await executor.insert(auditLogs).values({
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? {},
  });
}

export async function listAuditLogs(
  executor: DatabaseExecutor,
  limit: number,
  offset: number,
): Promise<readonly AuditLogRecord[]> {
  return executor
    .select({
      id: auditLogs.id,
      actor: auditLogs.actor,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

export type VerificationRecord = {
  readonly id: string;
  readonly creatorId: string;
  readonly purpose: VerificationPurpose;
  readonly code: string;
  readonly status: "PENDING" | "VERIFIED" | "EXPIRED" | "CANCELLED";
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly verifiedAt: Date | null;
};

const VERIFICATION_COLUMNS = {
  id: creatorVerifications.id,
  creatorId: creatorVerifications.creatorId,
  purpose: creatorVerifications.purpose,
  code: creatorVerifications.code,
  status: creatorVerifications.status,
  createdAt: creatorVerifications.createdAt,
  expiresAt: creatorVerifications.expiresAt,
  verifiedAt: creatorVerifications.verifiedAt,
} as const;

export async function findOpenVerification(
  executor: DatabaseExecutor,
  creatorId: string,
  purpose: VerificationPurpose,
): Promise<VerificationRecord | null> {
  const rows = await executor
    .select(VERIFICATION_COLUMNS)
    .from(creatorVerifications)
    .where(
      and(
        eq(creatorVerifications.creatorId, creatorId),
        eq(creatorVerifications.purpose, purpose),
        eq(creatorVerifications.status, "PENDING"),
      ),
    )
    .orderBy(asc(creatorVerifications.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertVerification(
  executor: DatabaseExecutor,
  input: {
    readonly creatorId: string;
    readonly purpose: VerificationPurpose;
    readonly code: string;
    readonly expiresAt: Date;
    readonly contactEmail: string | null;
  },
): Promise<VerificationRecord> {
  const rows = await executor
    .insert(creatorVerifications)
    .values({
      creatorId: input.creatorId,
      purpose: input.purpose,
      code: input.code,
      expiresAt: input.expiresAt,
      contactEmail: input.contactEmail,
    })
    .returning(VERIFICATION_COLUMNS);
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Failed to insert verification");
  }
  return row;
}

export async function markVerificationVerified(
  executor: DatabaseExecutor,
  verificationId: string,
  verifiedAt: Date,
): Promise<boolean> {
  const rows = await executor
    .update(creatorVerifications)
    .set({ status: "VERIFIED", verifiedAt })
    .where(
      and(eq(creatorVerifications.id, verificationId), eq(creatorVerifications.status, "PENDING")),
    )
    .returning({ id: creatorVerifications.id });
  return rows.length > 0;
}

export async function expireStaleVerifications(
  executor: DatabaseExecutor,
  now: Date,
): Promise<number> {
  const rows = await executor
    .update(creatorVerifications)
    .set({ status: "EXPIRED" })
    .where(
      and(
        eq(creatorVerifications.status, "PENDING"),
        sql`${creatorVerifications.expiresAt} <= ${now}`,
      ),
    )
    .returning({ id: creatorVerifications.id });
  return rows.length;
}

export type RejectionInput = {
  readonly reason: RejectionReason;
  readonly note?: string;
};
