import { type AdminConfig, parseAdminConfig } from "./runtime";

export { type AdminConfig, parseAdminConfig } from "./runtime";

/**
 * Server-only configuration for apps/admin.
 *
 * Phase 2 adds ADMIN_API_SECRET here. It stays server-side: the administrator
 * browser session never receives it, and every mutation is a server-to-server
 * call into the API's /internal/admin surface.
 */
export const adminConfig: AdminConfig = parseAdminConfig(process.env);
