import { parseWebConfig, type WebConfig } from "./runtime";

export { parseWebConfig, type WebConfig } from "./runtime";

/**
 * Server-only configuration for apps/web. This module must never be imported
 * from a client component: the browser receives values as props instead.
 */
export const webConfig: WebConfig = parseWebConfig(process.env);
