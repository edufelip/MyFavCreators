"use server";

import { RateLimitedError, submitCreatorUrl } from "@/lib/api";
import type { SubmissionState } from "./state";

/**
 * Submits a creator URL through the API.
 *
 * The browser never talks to the API directly for a write, so the rate limit and
 * every validation rule are applied server-side where they cannot be skipped.
 */
export async function submitCreatorAction(
  _previous: SubmissionState,
  formData: FormData,
): Promise<SubmissionState> {
  const url = formData.get("url");
  if (typeof url !== "string" || url.trim() === "") {
    return {
      outcome: "INVALID_URL",
      message: "Cole o link completo do perfil.",
      creatorSlug: null,
    };
  }

  try {
    const result = await submitCreatorUrl(url.trim());
    return {
      outcome: result.outcome,
      message: result.message,
      creatorSlug: result.creatorSlug,
    };
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return {
        outcome: null,
        message: "Muitos envios em pouco tempo. Tente novamente mais tarde.",
        creatorSlug: null,
      };
    }
    console.error("submission_failed", error instanceof Error ? error.message : "unknown");
    return {
      outcome: null,
      message: "Não foi possível enviar agora. Tente novamente em instantes.",
      creatorSlug: null,
    };
  }
}
