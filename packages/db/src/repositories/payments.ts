import type {
  BoostStatus,
  ModerationStatus,
  MoneyCents,
  PaymentStatus,
} from "@creator-outdoor/domain";
import { and, eq, lt, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import {
  optionalDate,
  optionalEnum,
  optionalString,
  readJsonObject,
  requireBoolean,
  requireDate,
  requireEnum,
  requireInteger,
  requireMoneyCents,
  requireRecord,
  requireString,
} from "../row";
import { boosts, paymentEvents, payments } from "../schema";

const PAYMENT_STATUS_VALUES = [
  "CREATED",
  "PENDING",
  "CONFIRMED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
] as const;
const BOOST_STATUS_VALUES = ["PENDING", "ACTIVE", "VOID", "REVERSED"] as const;
const MODERATION_STATUS_VALUES = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "REMOVED",
  "OPTOUT_VERIFICATION_PENDING",
  "OPTED_OUT",
] as const;

/** A payment together with the boost it funds and that creator's eligibility. */
export type PaymentWithBoost = {
  readonly paymentId: string;
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly paymentStatus: PaymentStatus;
  readonly amountCents: MoneyCents;
  readonly confirmedAt: Date | null;
  readonly boostId: string;
  readonly boostStatus: BoostStatus;
  readonly creatorId: string;
  readonly creatorSlug: string;
  readonly creatorModerationStatus: ModerationStatus;
  /** Private. Used to record a notification interest; never serialized. */
  readonly supporterEmail: string | null;
  /** What the payer agreed to be written about. Never serialized. */
  readonly notifyOnDethrone: boolean;
  readonly notifyWeeklyRecap: boolean;
};

function toPaymentWithBoost(value: unknown): PaymentWithBoost {
  const row = requireRecord(value);
  return {
    paymentId: requireString(row, "payment_id"),
    provider: requireString(row, "provider"),
    providerPaymentId: requireString(row, "provider_payment_id"),
    paymentStatus: requireEnum(row, "payment_status", PAYMENT_STATUS_VALUES),
    amountCents: requireMoneyCents(row, "amount_cents"),
    confirmedAt: optionalDate(row, "confirmed_at"),
    boostId: requireString(row, "boost_id"),
    boostStatus: requireEnum(row, "boost_status", BOOST_STATUS_VALUES),
    creatorId: requireString(row, "creator_id"),
    creatorSlug: requireString(row, "creator_slug"),
    creatorModerationStatus: requireEnum(row, "moderation_status", MODERATION_STATUS_VALUES),
    supporterEmail: optionalString(row, "supporter_email"),
    notifyOnDethrone: requireBoolean(row, "notify_on_dethrone"),
    notifyWeeklyRecap: requireBoolean(row, "notify_weekly_recap"),
  };
}

/**
 * Reads a payment and locks its row for the rest of the transaction.
 *
 * Two webhook deliveries for the same payment can arrive at the same instant on
 * different connections. `FOR UPDATE` on the payment row serialises them, so the
 * second one reads the state the first one committed rather than a stale copy —
 * without it, both could see PENDING and both could try to activate.
 */
export async function lockPaymentByProviderId(
  executor: DatabaseExecutor,
  provider: string,
  providerPaymentId: string,
): Promise<PaymentWithBoost | null> {
  const result: unknown[] = await executor.execute(sql`
    select
      p.id::text as payment_id,
      p.provider as provider,
      p.provider_payment_id as provider_payment_id,
      p.status as payment_status,
      p.amount_cents as amount_cents,
      p.confirmed_at as confirmed_at,
      b.id::text as boost_id,
      b.status as boost_status,
      b.supporter_email as supporter_email,
      b.notify_on_dethrone as notify_on_dethrone,
      b.notify_weekly_recap as notify_weekly_recap,
      c.id::text as creator_id,
      c.slug as creator_slug,
      c.moderation_status as moderation_status
    from payments p
    inner join boosts b on b.payment_id = p.id
    inner join creators c on c.id = b.creator_id
    where p.provider = ${provider} and p.provider_payment_id = ${providerPaymentId}
    for update of p
  `);
  const first = result[0];
  return first === undefined ? null : toPaymentWithBoost(first);
}

export async function findPaymentByIdWithBoost(
  executor: DatabaseExecutor,
  paymentId: string,
): Promise<PaymentWithBoost | null> {
  const result: unknown[] = await executor.execute(sql`
    select
      p.id::text as payment_id,
      p.provider as provider,
      p.provider_payment_id as provider_payment_id,
      p.status as payment_status,
      p.amount_cents as amount_cents,
      p.confirmed_at as confirmed_at,
      b.id::text as boost_id,
      b.status as boost_status,
      b.supporter_email as supporter_email,
      b.notify_on_dethrone as notify_on_dethrone,
      b.notify_weekly_recap as notify_weekly_recap,
      c.id::text as creator_id,
      c.slug as creator_slug,
      c.moderation_status as moderation_status
    from payments p
    inner join boosts b on b.payment_id = p.id
    inner join creators c on c.id = b.creator_id
    where p.id = ${paymentId}
  `);
  const first = result[0];
  return first === undefined ? null : toPaymentWithBoost(first);
}

export type CreatePaymentWithBoostInput = {
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly creatorId: string;
  readonly supporterName: string | null;
  readonly supporterMessage: string | null;
  readonly anonymous: boolean;
  readonly supporterEmail: string | null;
  readonly fanIdentityKey: string | null;
  /** Recorded on the boost, because consent belongs to the purchase. */
  readonly notifyOnDethrone: boolean;
  readonly notifyWeeklyRecap: boolean;
  readonly rawMetadata: Record<string, unknown>;
};

/**
 * Creates the payment and the boost it funds, together.
 *
 * A boost never exists without its payment, and the unique index on
 * `boosts.payment_id` makes it impossible for one payment to fund two.
 */
export async function insertPaymentWithBoost(
  executor: DatabaseExecutor,
  input: CreatePaymentWithBoostInput,
): Promise<{ readonly paymentId: string; readonly boostId: string }> {
  const paymentRows = await executor
    .insert(payments)
    .values({
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "PENDING",
      rawMetadata: input.rawMetadata,
    })
    .returning({ id: payments.id });
  const payment = paymentRows[0];
  if (payment === undefined) {
    throw new Error("Failed to insert payment");
  }

  const boostRows = await executor
    .insert(boosts)
    .values({
      creatorId: input.creatorId,
      amountCents: input.amountCents,
      currency: input.currency,
      supporterName: input.supporterName,
      supporterMessage: input.supporterMessage,
      anonymous: input.anonymous,
      supporterEmail: input.supporterEmail,
      fanIdentityKey: input.fanIdentityKey,
      notifyOnDethrone: input.notifyOnDethrone,
      notifyWeeklyRecap: input.notifyWeeklyRecap,
      paymentId: payment.id,
      status: "PENDING",
    })
    .returning({ id: boosts.id });
  const boost = boostRows[0];
  if (boost === undefined) {
    throw new Error("Failed to insert boost");
  }
  return { paymentId: payment.id, boostId: boost.id };
}

/**
 * Claims an event fingerprint.
 *
 * Returns false when the fingerprint already exists, which is how a replayed
 * webhook is detected. The uniqueness is a database constraint rather than an
 * application check on purpose: two concurrent deliveries would both pass a
 * read-then-write check, and only one can win a unique index.
 */
export async function claimPaymentEvent(
  executor: DatabaseExecutor,
  input: {
    readonly paymentId: string;
    readonly providerEventId: string | null;
    readonly eventFingerprint: string;
    readonly fromStatus: PaymentStatus | null;
    readonly toStatus: PaymentStatus;
    readonly payload: unknown;
  },
): Promise<boolean> {
  const rows = await executor
    .insert(paymentEvents)
    .values({
      paymentId: input.paymentId,
      providerEventId: input.providerEventId,
      eventFingerprint: input.eventFingerprint,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      payload: input.payload as never,
    })
    .onConflictDoNothing({ target: paymentEvents.eventFingerprint })
    .returning({ id: paymentEvents.id });
  return rows.length > 0;
}

export async function updatePaymentStatus(
  executor: DatabaseExecutor,
  input: {
    readonly paymentId: string;
    readonly status: PaymentStatus;
    readonly confirmedAt?: Date | null;
    readonly refundedAt?: Date | null;
    readonly at: Date;
  },
): Promise<void> {
  await executor
    .update(payments)
    .set({
      status: input.status,
      updatedAt: input.at,
      ...(input.confirmedAt === undefined ? {} : { confirmedAt: input.confirmedAt }),
      ...(input.refundedAt === undefined ? {} : { refundedAt: input.refundedAt }),
    })
    .where(eq(payments.id, input.paymentId));
}

export async function updateBoostStatus(
  executor: DatabaseExecutor,
  input: {
    readonly boostId: string;
    readonly status: BoostStatus;
    readonly confirmedAt?: Date | null;
    readonly rotationStartsAt?: Date | null;
    readonly rotationEndsAt?: Date | null;
    readonly at: Date;
  },
): Promise<void> {
  await executor
    .update(boosts)
    .set({
      status: input.status,
      updatedAt: input.at,
      ...(input.confirmedAt === undefined ? {} : { confirmedAt: input.confirmedAt }),
      ...(input.rotationStartsAt === undefined ? {} : { rotationStartsAt: input.rotationStartsAt }),
      ...(input.rotationEndsAt === undefined ? {} : { rotationEndsAt: input.rotationEndsAt }),
    })
    .where(eq(boosts.id, input.boostId));
}

export type CheckoutView = {
  readonly paymentId: string;
  readonly boostId: string;
  readonly creatorSlug: string;
  readonly creatorDisplayName: string;
  readonly amountCents: MoneyCents;
  readonly status: PaymentStatus;
  readonly metadata: Record<string, unknown>;
};

/**
 * Everything the checkout screen needs, by payment id.
 *
 * The PIX payload is read back from the payment rather than carried in the URL:
 * a query string ends up in browser history, referrer headers and access logs,
 * and the payload is what a stranger would need to pay the wrong charge.
 */
export async function getCheckoutView(
  executor: DatabaseExecutor,
  paymentId: string,
): Promise<CheckoutView | null> {
  const result: unknown[] = await executor.execute(sql`
    select
      p.id::text as payment_id,
      p.status as payment_status,
      p.amount_cents as amount_cents,
      p.raw_metadata as raw_metadata,
      b.id::text as boost_id,
      c.slug as creator_slug,
      c.display_name as creator_display_name
    from payments p
    inner join boosts b on b.payment_id = p.id
    inner join creators c on c.id = b.creator_id
    where p.id = ${paymentId}
  `);
  const first = result[0];
  if (first === undefined) {
    return null;
  }
  const row = requireRecord(first);
  return {
    paymentId: requireString(row, "payment_id"),
    boostId: requireString(row, "boost_id"),
    creatorSlug: requireString(row, "creator_slug"),
    creatorDisplayName: requireString(row, "creator_display_name"),
    amountCents: requireMoneyCents(row, "amount_cents"),
    status: requireEnum(row, "payment_status", PAYMENT_STATUS_VALUES),
    metadata: readJsonObject(row, "raw_metadata"),
  };
}

export type PaymentStatusView = {
  readonly status: PaymentStatus;
  readonly boostStatus: BoostStatus;
  readonly creatorSlug: string;
  readonly amountCents: MoneyCents;
  readonly confirmedAt: Date | null;
};

/** What the checkout screen polls. Carries no provider identifier. */
export async function getPaymentStatusView(
  executor: DatabaseExecutor,
  paymentId: string,
): Promise<PaymentStatusView | null> {
  const found = await findPaymentByIdWithBoost(executor, paymentId);
  return found === null
    ? null
    : {
        status: found.paymentStatus,
        boostStatus: found.boostStatus,
        creatorSlug: found.creatorSlug,
        amountCents: found.amountCents,
        confirmedAt: found.confirmedAt,
      };
}

export type OwedRefund = {
  readonly paymentId: string;
  readonly providerPaymentId: string;
  readonly creatorId: string;
};

/**
 * Money taken for a promotion that was never delivered.
 *
 * A boost is VOID behind a CONFIRMED payment in exactly one situation: the
 * creator stopped being publicly eligible while the PIX was in flight, so the
 * boost was refused and a refund was owed. If that refund call failed, this is
 * the only record that it is still owed — the payment is CONFIRMED, so the
 * unsettled sweep will never look at it, and without this query the platform
 * simply keeps the money.
 */
export async function listOwedRefunds(
  executor: DatabaseExecutor,
  provider: string,
  limit: number,
): Promise<readonly OwedRefund[]> {
  const result: unknown[] = await executor.execute(sql`
    select
      p.id::text as payment_id,
      p.provider_payment_id as provider_payment_id,
      b.creator_id::text as creator_id
    from payments p
    inner join boosts b on b.payment_id = p.id
    where p.provider = ${provider}
      and p.status = 'CONFIRMED'
      and p.refunded_at is null
      and b.status = 'VOID'
    order by p.confirmed_at asc
    limit ${limit}
  `);
  return result.map((value) => {
    const row = requireRecord(value);
    return {
      paymentId: requireString(row, "payment_id"),
      providerPaymentId: requireString(row, "provider_payment_id"),
      creatorId: requireString(row, "creator_id"),
    };
  });
}

/** Payments that never settled and are old enough to be reconciled. */
export async function listUnsettledPayments(
  executor: DatabaseExecutor,
  provider: string,
  olderThan: Date,
  limit: number,
): Promise<ReadonlyArray<{ readonly providerPaymentId: string; readonly status: PaymentStatus }>> {
  const rows = await executor
    .select({ providerPaymentId: payments.providerPaymentId, status: payments.status })
    .from(payments)
    .where(
      and(
        eq(payments.provider, provider),
        lt(payments.updatedAt, olderThan),
        sql`${payments.status} in ('CREATED', 'PENDING')`,
      ),
    )
    .limit(limit);
  return rows;
}

/** A payment as the administration surface sees it. */
export type AdminPaymentRow = {
  readonly id: string;
  readonly status: PaymentStatus;
  readonly amountCents: MoneyCents;
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly boostId: string | null;
  readonly boostStatus: BoostStatus | null;
  readonly creatorId: string | null;
  readonly creatorSlug: string | null;
  readonly creatorDisplayName: string | null;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  readonly refundedAt: Date | null;
};

function toAdminPaymentRow(value: unknown): AdminPaymentRow {
  const row = requireRecord(value);
  return {
    id: requireString(row, "id"),
    status: requireEnum(row, "status", PAYMENT_STATUS_VALUES),
    amountCents: requireMoneyCents(row, "amount_cents"),
    provider: requireString(row, "provider"),
    providerPaymentId: requireString(row, "provider_payment_id"),
    boostId: optionalString(row, "boost_id"),
    boostStatus: optionalEnum(row, "boost_status", BOOST_STATUS_VALUES),
    creatorId: optionalString(row, "creator_id"),
    creatorSlug: optionalString(row, "creator_slug"),
    creatorDisplayName: optionalString(row, "creator_display_name"),
    createdAt: requireDate(row, "created_at"),
    confirmedAt: optionalDate(row, "confirmed_at"),
    refundedAt: optionalDate(row, "refunded_at"),
  };
}

/**
 * The payment ledger, for an operator answering a support question.
 *
 * The join to the boost is a LEFT JOIN on purpose: a payment whose boost row is
 * missing is precisely the kind of inconsistency an operator is looking for, and
 * an inner join would hide it by showing nothing at all.
 *
 * Nothing here selects the supporter's email or the provider's raw payload. The
 * screen has no need for either, and a query that never reads them is a screen
 * that can never leak them.
 */
export async function listAdminPayments(
  executor: DatabaseExecutor,
  options: {
    readonly status?: PaymentStatus;
    readonly limit: number;
    readonly offset: number;
  },
): Promise<{ readonly payments: readonly AdminPaymentRow[]; readonly total: number }> {
  const statusFilter = options.status === undefined ? sql`true` : sql`p.status = ${options.status}`;

  const rows: unknown[] = await executor.execute(sql`
    select
      p.id::text as id,
      p.status::text as status,
      p.amount_cents as amount_cents,
      p.provider as provider,
      p.provider_payment_id as provider_payment_id,
      b.id::text as boost_id,
      b.status::text as boost_status,
      c.id::text as creator_id,
      c.slug as creator_slug,
      c.display_name as creator_display_name,
      p.created_at as created_at,
      p.confirmed_at as confirmed_at,
      p.refunded_at as refunded_at
    from payments p
    left join boosts b on b.payment_id = p.id
    left join creators c on c.id = b.creator_id
    where ${statusFilter}
    order by p.created_at desc
    limit ${options.limit} offset ${options.offset}
  `);

  const counted: unknown[] = await executor.execute(
    sql`select count(*)::int as total from payments p where ${statusFilter}`,
  );
  const first = counted[0];

  return {
    payments: rows.map(toAdminPaymentRow),
    total: first === undefined ? 0 : requireInteger(requireRecord(first), "total"),
  };
}

export async function findAdminPayment(
  executor: DatabaseExecutor,
  id: string,
): Promise<AdminPaymentRow | null> {
  const rows: unknown[] = await executor.execute(sql`
    select
      p.id::text as id,
      p.status::text as status,
      p.amount_cents as amount_cents,
      p.provider as provider,
      p.provider_payment_id as provider_payment_id,
      b.id::text as boost_id,
      b.status::text as boost_status,
      c.id::text as creator_id,
      c.slug as creator_slug,
      c.display_name as creator_display_name,
      p.created_at as created_at,
      p.confirmed_at as confirmed_at,
      p.refunded_at as refunded_at
    from payments p
    left join boosts b on b.payment_id = p.id
    left join creators c on c.id = b.creator_id
    where p.id = ${id}
    limit 1
  `);
  const first = rows[0];
  return first === undefined ? null : toAdminPaymentRow(first);
}
