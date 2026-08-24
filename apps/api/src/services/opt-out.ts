import { randomInt } from "node:crypto";
import type { OptOutChallengeDto, OptOutVerificationOutcome } from "@creator-outdoor/contracts";
import {
  type Database,
  findCreatorBySlug,
  findOpenVerification,
  insertVerification,
  markVerificationVerified,
  withTransaction,
  writeAuditLog,
} from "@creator-outdoor/db";
import {
  formatOwnershipCode,
  OWNERSHIP_CODE_ALPHABET,
  OWNERSHIP_CODE_LENGTH,
  textContainsOwnershipCode,
} from "@creator-outdoor/domain";
import { applyModerationChange } from "./moderation";

export const OPT_OUT_CODE_TTL_HOURS = 72;

/** Uniformly random over the unambiguous alphabet, from a CSPRNG. */
function generateOwnershipCode(): string {
  let body = "";
  for (let index = 0; index < OWNERSHIP_CODE_LENGTH; index += 1) {
    body += OWNERSHIP_CODE_ALPHABET.charAt(randomInt(OWNERSHIP_CODE_ALPHABET.length));
  }
  return formatOwnershipCode(body);
}

export class CreatorNotPubliclyVisibleError extends Error {
  override readonly name = "CreatorNotPubliclyVisibleError";
}

/**
 * Opens a removal request.
 *
 * The request issues a challenge and **changes nothing public**. The creator
 * stays exactly as visible as before, because an unauthenticated visitor must
 * never be able to affect a creator's placement simply by asking: if a pending
 * request took the creator off the leaderboard, anyone could knock the current
 * #1 off the billboard with one click.
 *
 * Only proof of control of the profile completes the removal. The
 * OPTOUT_VERIFICATION_PENDING moderation status exists for an administrator who
 * chooses to hold a profile during a disputed removal — it is never applied by
 * the request itself.
 *
 * Repeating the request returns the existing open challenge rather than issuing
 * a second code, which also makes the endpoint safe to retry.
 */
export async function requestOptOut(
  database: Database,
  input: { readonly slug: string; readonly contactEmail?: string | undefined; readonly now: Date },
): Promise<OptOutChallengeDto> {
  const creator = await findCreatorBySlug(database, input.slug);
  if (creator === null || creator.moderationStatus === "OPTED_OUT") {
    throw new CreatorNotPubliclyVisibleError(`No open profile for ${input.slug}`);
  }

  const existing = await findOpenVerification(database, creator.id, "OPTOUT");
  if (existing !== null && existing.expiresAt.getTime() > input.now.getTime()) {
    return toChallenge(existing.code, existing.expiresAt);
  }

  const expiresAt = new Date(input.now.getTime() + OPT_OUT_CODE_TTL_HOURS * 60 * 60 * 1000);
  const verification = await insertVerification(database, {
    creatorId: creator.id,
    purpose: "OPTOUT",
    code: generateOwnershipCode(),
    expiresAt,
    contactEmail: input.contactEmail ?? null,
  });

  // The request itself is only recorded, never acted on.
  await writeAuditLog(database, {
    actor: "public:opt-out-request",
    action: "creator.optout_requested",
    targetType: "creator",
    targetId: creator.id,
    metadata: { verificationId: verification.id },
  });

  return toChallenge(verification.code, verification.expiresAt);
}

function toChallenge(code: string, expiresAt: Date): OptOutChallengeDto {
  return {
    code,
    expiresAt: expiresAt.toISOString(),
    instructions:
      "Adicione este código à bio ou descrição do perfil e volte aqui para confirmar. " +
      "Depois da confirmação o perfil sai do Creator Outdoor imediatamente.",
  };
}

export type OptOutVerificationResult = {
  readonly outcome: OptOutVerificationOutcome;
  readonly message: string;
};

/**
 * Completes a removal once the code is proven to be on the profile.
 *
 * The requester supplies the profile text; Creator Outdoor does not scrape
 * platforms. On success the creator is hidden immediately from every public
 * surface, the profile is suppressed against resubmission, and the decision is
 * audited — all in one transaction.
 */
export async function verifyOptOut(
  database: Database,
  input: { readonly slug: string; readonly profileText: string; readonly now: Date },
): Promise<OptOutVerificationResult> {
  const creator = await findCreatorBySlug(database, input.slug);
  if (creator === null) {
    throw new CreatorNotPubliclyVisibleError(`No profile for ${input.slug}`);
  }

  const verification = await findOpenVerification(database, creator.id, "OPTOUT");
  if (verification === null) {
    return {
      outcome: "NO_OPEN_REQUEST",
      message: "Não há pedido de remoção aberto para este perfil.",
    };
  }
  if (verification.expiresAt.getTime() <= input.now.getTime()) {
    return {
      outcome: "EXPIRED",
      message: "O código expirou. Peça a remoção novamente para receber um novo código.",
    };
  }
  if (!textContainsOwnershipCode(input.profileText, verification.code)) {
    return {
      outcome: "CODE_NOT_FOUND",
      message: "Não encontramos o código no texto enviado. Confira e tente de novo.",
    };
  }

  await withTransaction(database, async (tx) => {
    await markVerificationVerified(tx, verification.id, input.now);
    await writeAuditLog(tx, {
      actor: "public:opt-out-verified",
      action: "creator.optout_verified",
      targetType: "creator",
      targetId: creator.id,
      metadata: { verificationId: verification.id },
    });
  });

  await applyModerationChange(database, {
    creatorId: creator.id,
    to: "OPTED_OUT",
    actor: "public:opt-out-verified",
    action: "creator.opted_out",
  });

  return {
    outcome: "VERIFIED",
    message: "Perfil removido do Creator Outdoor.",
  };
}
