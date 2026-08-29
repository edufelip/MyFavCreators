/**
 * What may be written to a log about a failure.
 *
 * Re-exported from @creator-outdoor/domain so all applications (api, web, admin)
 * share identical redaction and sanitization rules.
 */
export {
  type DescribedError,
  describeError,
  sanitize,
} from "@creator-outdoor/domain";
