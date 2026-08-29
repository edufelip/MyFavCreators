import { randomInt } from "node:crypto";
import type { ClaimChallengeDto, ClaimVerificationOutcome } from "@creator-outdoor/contracts";
import {
  type ClaimedCreator,
  type Database,
  findCategoryBySlug,
  findCreatorByClaimToken,
  findCreatorBySlug,
  findOpenVerification,
  insertVerification,
  markVerificationVerified,
  setCreatorClaimStatus,
  updateCreatorProfile,
  upsertCreatorClaim,
  withTransaction,
  writeAuditLog,
} from "@creator-outdoor/db";
import {
  createClaimToken,
  formatOwnershipCode,
  hashClaimToken,
  isPubliclyEligible,
  normalizeEmail,
  OWNERSHIP_CODE_ALPHABET,
  OWNERSHIP_CODE_LENGTH,
  sanitizeCreatorBio,
  textContainsOwnershipCode,
} from "@creator-outdoor/domain";

export const CLAIM_CODE_TTL_HOURS = 72;

/** Uniformly random over the unambiguous alphabet, from a CSPRNG. */
function generateOwnershipCode(): string {
  let body = "";
  for (let index = 0; index < OWNERSHIP_CODE_LENGTH; index += 1) {
    body += OWNERSHIP_CODE_ALPHABET.charAt(randomInt(OWNERSHIP_CODE_ALPHABET.length));
  }
  return formatOwnershipCode(body);
}

export class CreatorNotClaimableError extends Error {
  override readonly name = "CreatorNotClaimableError";
}

/**
 * Opens a claim.
 *
 * Issues a challenge and changes nothing public — the same rule the removal
 * flow follows, and for the same reason: an unauthenticated visitor asking
 * about a profile must never move it. `claimStatus` becomes PENDING, which is
 * an administrative marker, not a public one.
 *
 * Repeating the request returns the open challenge rather than issuing a second
 * code, so the endpoint is safe to retry and a flood cannot mint codes.
 */
export async function requestClaim(
  database: Database,
  input: { readonly slug: string; readonly now: Date },
): Promise<ClaimChallengeDto> {
  const creator = await findCreatorBySlug(database, input.slug);
  if (creator === null || !isPubliclyEligible(creator.moderationStatus)) {
    throw new CreatorNotClaimableError(`No public profile for ${input.slug}`);
  }

  const existing = await findOpenVerification(database, creator.id, "CLAIM");
  if (existing !== null && existing.expiresAt.getTime() > input.now.getTime()) {
    return toChallenge(existing.code, existing.expiresAt);
  }

  const expiresAt = new Date(input.now.getTime() + CLAIM_CODE_TTL_HOURS * 60 * 60 * 1000);
  const verification = await insertVerification(database, {
    creatorId: creator.id,
    purpose: "CLAIM",
    code: generateOwnershipCode(),
    expiresAt,
    contactEmail: null,
  });

  await withTransaction(database, async (tx) => {
    await setCreatorClaimStatus(tx, creator.id, "PENDING", input.now);
    await writeAuditLog(tx, {
      actor: "public:claim-request",
      action: "creator.claim_requested",
      targetType: "creator",
      targetId: creator.id,
      metadata: { verificationId: verification.id },
    });
  });

  return toChallenge(verification.code, verification.expiresAt);
}

function toChallenge(code: string, expiresAt: Date): ClaimChallengeDto {
  return {
    code,
    expiresAt: expiresAt.toISOString(),
    instructions:
      "Adicione este codigo a bio ou descricao do perfil e volte aqui para confirmar. " +
      "Depois da confirmacao voce recebe um link de gerenciamento deste perfil.",
  };
}

export type ClaimVerificationResult = {
  readonly outcome: ClaimVerificationOutcome;
  readonly message: string;
  /**
   * Shown exactly once, at the moment of verification. Only its hash is stored,
   * so a lost token is re-issued by proving the claim again — never recovered.
   */
  readonly manageToken: string | null;
};

/**
 * Completes a claim once the code is proven to be on the profile.
 *
 * The claimant supplies the profile text; Creator Outdoor does not scrape
 * platforms. Verifying again replaces the token, which is how somebody who lost
 * theirs gets back in and how the previous one stops working.
 */
export async function verifyClaim(
  database: Database,
  input: {
    readonly slug: string;
    readonly profileText: string;
    readonly email?: string | undefined;
    readonly now: Date;
  },
): Promise<ClaimVerificationResult> {
  const creator = await findCreatorBySlug(database, input.slug);
  if (creator === null || !isPubliclyEligible(creator.moderationStatus)) {
    throw new CreatorNotClaimableError(`No public profile for ${input.slug}`);
  }

  const verification = await findOpenVerification(database, creator.id, "CLAIM");
  if (verification === null) {
    return {
      outcome: "NO_OPEN_REQUEST",
      message: "Nao ha pedido de reivindicacao aberto para este perfil.",
      manageToken: null,
    };
  }
  if (verification.expiresAt.getTime() <= input.now.getTime()) {
    return {
      outcome: "EXPIRED",
      message: "O codigo expirou. Peca a reivindicacao novamente para receber um novo codigo.",
      manageToken: null,
    };
  }
  if (!textContainsOwnershipCode(input.profileText, verification.code)) {
    return {
      outcome: "CODE_NOT_FOUND",
      message: "Nao encontramos o codigo no texto enviado. Confira e tente de novo.",
      manageToken: null,
    };
  }

  const token = createClaimToken();
  const supplied = readEmail(input.email);
  const email = supplied.kind === "USABLE" ? supplied.email : null;

  await withTransaction(database, async (tx) => {
    await markVerificationVerified(tx, verification.id, input.now);
    await upsertCreatorClaim(tx, {
      creatorId: creator.id,
      email,
      tokenHash: hashClaimToken(token),
    });
    await setCreatorClaimStatus(tx, creator.id, "CLAIMED", input.now);
    await writeAuditLog(tx, {
      actor: "public:claim-verified",
      action: "creator.claimed",
      targetType: "creator",
      targetId: creator.id,
      // The token is never written anywhere but its own hashed column.
      metadata: { verificationId: verification.id },
    });
  });

  return {
    outcome: "VERIFIED",
    message:
      supplied.kind === "UNUSABLE"
        ? "Perfil reivindicado. Guarde o link de gerenciamento. Nao salvamos o e-mail informado: cadastre um endereco valido na pagina de gerenciamento."
        : "Perfil reivindicado. Guarde o link de gerenciamento.",
    manageToken: token,
  };
}

/**
 * An address a creator typed, and whether it can be used.
 *
 * Three outcomes rather than two. "None given" and "given but unusable" both
 * stored `null`, which meant a creator who mistyped their address was told
 * "Perfil reivindicado" and nothing else — the claim really did succeed, so the
 * message was true, and the half they cared about had been dropped on the
 * floor. They would find out the first time a notification did not arrive.
 */
type SuppliedEmail =
  | { readonly kind: "NONE" }
  | { readonly kind: "USABLE"; readonly email: string }
  | { readonly kind: "UNUSABLE" };

function readEmail(value: string | undefined): SuppliedEmail {
  if (value === undefined || value.trim() === "") {
    return { kind: "NONE" };
  }
  try {
    return { kind: "USABLE", email: normalizeEmail(value) };
  } catch {
    // Still not worth failing a proven claim over — the code really was on the
    // profile. It is worth saying out loud, which is what the caller does.
    return { kind: "UNUSABLE" };
  }
}

/** Who a management token belongs to, or null. Never throws on a bad token. */
export async function authenticateClaim(
  database: Database,
  token: string | null,
): Promise<ClaimedCreator | null> {
  if (token === null || token.length < 20) {
    return null;
  }
  return findCreatorByClaimToken(database, hashClaimToken(token));
}

export type UpdateProfileInput = {
  readonly bio?: string | null | undefined;
  readonly categorySlug?: string | undefined;
  readonly now: Date;
};

/**
 * What a claimed creator may change about their own profile.
 *
 * Deliberately narrow: the bio and the category. The display name and the
 * platform links are what a visitor uses to tell one profile from another, and
 * letting a claimant rewrite them would turn a claimed profile into a way to
 * impersonate somebody else after the fact.
 */
export async function updateClaimedProfile(
  database: Database,
  claimed: ClaimedCreator,
  input: UpdateProfileInput,
): Promise<void> {
  /*
   * Only touched when the request said something about it. `sanitizeCreatorBio`
   * turns `undefined` into `null`, so sanitising unconditionally meant a
   * category-only update wiped the bio and reported success.
   */
  const bio = input.bio === undefined ? undefined : sanitizeCreatorBio(input.bio);

  let categoryId: string | undefined;
  if (input.categorySlug !== undefined) {
    const category = await findCategoryBySlug(database, input.categorySlug);
    if (category === null || !category.isActive) {
      throw new CreatorNotClaimableError(`Unknown category ${input.categorySlug}`);
    }
    categoryId = category.id;
  }

  await withTransaction(database, async (tx) => {
    await updateCreatorProfile(tx, {
      creatorId: claimed.creatorId,
      ...(bio === undefined ? {} : { bio }),
      ...(categoryId === undefined ? {} : { categoryId }),
      at: input.now,
    });
    await writeAuditLog(tx, {
      actor: `creator:${claimed.slug}`,
      action: "creator.profile_updated",
      targetType: "creator",
      targetId: claimed.creatorId,
      metadata: {
        bioChanged: bio !== undefined,
        bioLength: bio === undefined || bio === null ? 0 : bio.length,
        categoryChanged: categoryId !== undefined,
      },
    });
  });
}
