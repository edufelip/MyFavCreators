import type { ProductConfig } from "@creator-outdoor/config";
import type {
  CreatorSubmissionOutcome,
  CreatorSubmissionResponseDto,
} from "@creator-outdoor/contracts";
import {
  type Database,
  findCategoryIdBySlug,
  findCreatorByNormalizedKey,
  insertCreatorWithLink,
  isNormalizedKeySuppressed,
  slugExists,
  withTransaction,
} from "@creator-outdoor/db";
import {
  creatorSlugCandidate,
  type NormalizedCreatorUrl,
  normalizeCreatorUrl,
  type UrlRejectionReason,
  withSlugDiscriminator,
} from "@creator-outdoor/domain";
import { deriveMetadataFromUrl } from "../metadata/url-derived";

export type SubmissionResult = CreatorSubmissionResponseDto;

const URL_REJECTION_MESSAGES: Readonly<Record<UrlRejectionReason, string>> = {
  INVALID_URL: "Não reconhecemos esse endereço. Cole o link completo do perfil.",
  UNSUPPORTED_PROTOCOL: "Use um endereço que comece com https://.",
  EMBEDDED_CREDENTIALS: "Esse endereço contém dados de acesso e não pode ser usado.",
  PRIVATE_HOST: "Esse endereço não aponta para um perfil público.",
  INVALID_PROFILE_URL: "Esse link não aponta para um perfil de criador.",
};

function outcome(
  value: CreatorSubmissionOutcome,
  message: string,
  creatorSlug: string | null = null,
): SubmissionResult {
  return { outcome: value, creatorSlug, message };
}

async function resolveAvailableSlug(
  database: Database,
  normalized: NormalizedCreatorUrl,
  displayName: string,
): Promise<string> {
  const base = creatorSlugCandidate(displayName, normalized.handle) ?? "criador";
  if (!(await slugExists(database, base))) {
    return base;
  }
  for (let discriminator = 2; discriminator < 50; discriminator += 1) {
    const candidate = withSlugDiscriminator(base, discriminator);
    if (!(await slugExists(database, candidate))) {
      return candidate;
    }
  }
  // Fall back to something guaranteed unique rather than failing the submission.
  return withSlugDiscriminator(base, Date.now() % 100_000);
}

/**
 * Accepts a creator submission.
 *
 * Order matters and is deliberate:
 *
 * 1. normalize, which is also the security boundary for an attacker-supplied URL
 * 2. refuse a suppressed profile, so a verified opt-out cannot be undone by
 *    simply resubmitting the same link
 * 3. refuse a duplicate, so two spellings of one profile never compete for the
 *    same fandom's money
 * 4. insert as PENDING_REVIEW — nothing is public until a human approves it
 *
 * The response never reveals whether a non-public creator exists: a pending,
 * rejected or removed profile answers the same way, so submissions cannot be
 * used to enumerate the moderation queue.
 */
export async function submitCreator(
  database: Database,
  product: ProductConfig,
  input: { readonly url: string; readonly categorySlug?: string | undefined },
): Promise<SubmissionResult> {
  const normalized = normalizeCreatorUrl(input.url);
  if (!normalized.ok) {
    return outcome("INVALID_URL", URL_REJECTION_MESSAGES[normalized.reason]);
  }

  if (await isNormalizedKeySuppressed(database, normalized.normalizedKey)) {
    return outcome(
      "SUPPRESSED",
      "Este perfil pediu a remoção do Creator Outdoor e não pode ser reenviado.",
    );
  }

  const existing = await findCreatorByNormalizedKey(database, normalized.normalizedKey);
  if (existing !== null) {
    return existing.moderationStatus === "APPROVED"
      ? outcome("ALREADY_EXISTS", "Esse perfil já está no ranking.", existing.slug)
      : outcome("ALREADY_PENDING", "Esse perfil já foi enviado e está em análise.");
  }

  const categorySlug = input.categorySlug ?? product.launchCategory;
  const categoryId =
    (await findCategoryIdBySlug(database, categorySlug)) ??
    (await findCategoryIdBySlug(database, product.launchCategory)) ??
    null;
  if (categoryId === null) {
    throw new Error(`Launch category "${product.launchCategory}" is missing from the database`);
  }

  const metadata = deriveMetadataFromUrl(normalized);
  const slug = await resolveAvailableSlug(database, normalized, metadata.displayName);

  try {
    await withTransaction(database, async (tx) => {
      await insertCreatorWithLink(tx, {
        slug,
        displayName: metadata.displayName,
        bio: metadata.bio,
        avatarUrl: metadata.avatarUrl,
        categoryId,
        link: {
          platform: normalized.platform,
          handle: normalized.handle,
          url: normalized.canonicalUrl,
          normalizedKey: normalized.normalizedKey,
        },
      });
    });
  } catch (error) {
    // Two submissions of the same profile can race past the read above; the
    // unique index on normalized_key is what actually decides, and the loser
    // reports the same outcome it would have got a millisecond earlier.
    if (isUniqueViolation(error)) {
      return outcome("ALREADY_PENDING", "Esse perfil já foi enviado e está em análise.");
    }
    throw error;
  }

  return outcome(
    "SUBMITTED",
    "Perfil enviado para análise. Ele aparece no ranking depois da aprovação.",
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = "code" in error ? error.code : undefined;
  if (code === "23505" || code === "ERR_POSTGRES_SERVER_ERROR") {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return message.includes("duplicate key value") || message.includes("unique constraint");
}
