import "server-only";

import { adminConfig } from "@creator-outdoor/config/admin";
import {
  AcknowledgementDto,
  AdminAuditLogListDto,
  AdminCreatorDto,
  AdminCreatorListDto,
  AdminReportListDto,
  type ModerationStatusDto,
  parseContract,
  type RejectionReasonDto,
} from "@creator-outdoor/contracts";

const ADMIN_SECRET_HEADER = "x-admin-api-secret";

/**
 * The server-to-server client for the API's internal admin surface.
 *
 * Every call happens on the admin Next.js server. The shared secret is attached
 * here and never reaches the browser: no client component imports this module,
 * and `server-only` makes that a build error rather than a convention.
 */
async function adminFetch(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(new URL(path, adminConfig.apiOrigin), {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      accept: "application/json",
      "content-type": "application/json",
      [ADMIN_SECRET_HEADER]: adminConfig.adminApiSecret,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Admin API ${path} responded ${response.status}`);
  }
  return response.json();
}

export async function fetchModerationQueue(status: ModerationStatusDto) {
  const payload = await adminFetch(`/internal/admin/creators?status=${status}&limit=100`);
  return parseContract(AdminCreatorListDto, payload, "AdminCreatorList");
}

export async function fetchAdminCreator(id: string) {
  const payload = await adminFetch(`/internal/admin/creators/${id}`);
  return parseContract(AdminCreatorDto, payload, "AdminCreator");
}

export async function approveCreator(
  id: string,
  patch: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    categorySlug?: string;
  },
) {
  const payload = await adminFetch(`/internal/admin/creators/${id}/approve`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
  return parseContract(AcknowledgementDto, payload, "Acknowledgement");
}

export async function rejectCreator(id: string, reason: RejectionReasonDto, note?: string) {
  const payload = await adminFetch(`/internal/admin/creators/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason, ...(note === undefined ? {} : { note }) }),
  });
  return parseContract(AcknowledgementDto, payload, "Acknowledgement");
}

export async function removeCreator(id: string, note?: string) {
  const payload = await adminFetch(`/internal/admin/creators/${id}/remove`, {
    method: "POST",
    body: JSON.stringify(note === undefined ? {} : { note }),
  });
  return parseContract(AcknowledgementDto, payload, "Acknowledgement");
}

export async function restoreCreator(id: string) {
  const payload = await adminFetch(`/internal/admin/creators/${id}/restore`, { method: "POST" });
  return parseContract(AcknowledgementDto, payload, "Acknowledgement");
}

export async function updateCreatorMetadata(
  id: string,
  patch: {
    displayName?: string;
    bio?: string | null;
    avatarUrl?: string | null;
    categorySlug?: string;
  },
) {
  const payload = await adminFetch(`/internal/admin/creators/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return parseContract(AcknowledgementDto, payload, "Acknowledgement");
}

export async function fetchReports() {
  const payload = await adminFetch("/internal/admin/reports?status=OPEN&limit=100");
  return parseContract(AdminReportListDto, payload, "AdminReportList");
}

export async function resolveReport(id: string) {
  const payload = await adminFetch(`/internal/admin/reports/${id}/resolve`, { method: "POST" });
  return parseContract(AcknowledgementDto, payload, "Acknowledgement");
}

export async function fetchAuditLogs() {
  const payload = await adminFetch("/internal/admin/audit-logs?limit=100");
  return parseContract(AdminAuditLogListDto, payload, "AdminAuditLogList");
}
