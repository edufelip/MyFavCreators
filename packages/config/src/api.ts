import { type ApiConfig, parseApiConfig } from "./runtime";

export { type ApiConfig, parseApiConfig } from "./runtime";

/**
 * Parsed once per process. Importing this module in an invalid environment
 * throws, so a misconfigured API fails at startup rather than at the first
 * request.
 */
export const apiConfig: ApiConfig = parseApiConfig(process.env);
