"use client";

import {
  type CheckoutDto,
  isContractViolation,
  PaymentStatusResponseDto,
  parseContract,
} from "@creator-outdoor/contracts";
import { useCallback, useEffect, useState } from "react";
import { BoostDisclosure } from "@/components/boost-disclosure";
import { copy } from "@/lib/copy";
import { formatBrl, formatDuration } from "@/lib/format";

export type CheckoutViewProps = {
  readonly checkout: CheckoutDto;
  readonly initialStatus: PaymentStatusResponseDto;
  readonly qrSvg: string;
};

const POLL_INTERVAL_MS = 3_000;
const HIDDEN_POLL_INTERVAL_MS = 20_000;

/**
 * The PIX checkout screen.
 *
 * It polls the API for the payment state and never decides anything itself:
 * what the browser believes about a payment is not authoritative, and only the
 * API and the provider agree on the truth. Polling slows right down while the
 * tab is hidden, because a phone in someone's pocket should not hammer the API.
 */
export function CheckoutView({ checkout, initialStatus, qrSvg }: CheckoutViewProps) {
  const [status, setStatus] = useState(initialStatus);
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(checkout.expiresAt).getTime() - Date.now()),
  );

  const settled = status.status !== "PENDING" && status.status !== "CREATED";
  const confirmed = status.status === "CONFIRMED" && status.boostStatus === "ACTIVE";

  useEffect(() => {
    if (settled) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const response = await fetch(`/api/payments/${checkout.paymentId}/status`, {
          cache: "no-store",
        });
        if (response.ok && !cancelled) {
          // Validated rather than asserted. The proxy this polls already checks
          // the contract, but an assertion here would trust that hop instead of
          // checking it, and what is being trusted is the state of somebody's
          // payment. A payload that does not match is ignored; the next poll
          // reads the state again.
          setStatus(
            parseContract(PaymentStatusResponseDto, await response.json(), "PaymentStatus"),
          );
        }
      } catch (error) {
        // A failed poll is not an error the customer needs to see; the next one
        // will succeed, and the payment state is unaffected either way. A
        // payload that violated the contract is worth a line in the console,
        // because it means the two sides have drifted apart.
        if (isContractViolation(error)) {
          console.error("payment_status_contract_violation");
        }
      }
      if (!cancelled) {
        timer = setTimeout(poll, document.hidden ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
      }
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checkout.paymentId, settled]);

  useEffect(() => {
    if (settled) {
      return;
    }
    const deadline = new Date(checkout.expiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, deadline - Date.now()));
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [checkout.expiresAt, settled]);

  const copyCode = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.([40, 30, 40]);
      }
      await navigator.clipboard.writeText(checkout.copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }, [checkout.copyPaste]);

  if (confirmed) {
    return <BoostSuccess checkout={checkout} status={status} />;
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-black tracking-tight text-white">{copy.checkout.title}</h1>
        <p className="mt-1 text-sm text-white/60">
          {checkout.creatorDisplayName} · {formatBrl(checkout.amountCents)}
        </p>
      </header>

      {/* Mandatory on the PIX checkout screen. */}
      <BoostDisclosure showRankQuoteNote={checkout.origin === "TAKE_FIRST_PLACE"} />

      {settled ? (
        <p
          data-testid="checkout-settled"
          data-status={status.status}
          className="text-sm text-white/80"
        >
          {status.status === "REFUNDED"
            ? copy.checkout.refunded
            : status.boostStatus === "VOID"
              ? copy.checkout.voided
              : copy.checkout.failed}
        </p>
      ) : (
        <>
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white p-4">
            <div
              data-testid="checkout-qr"
              role="img"
              aria-label={copy.checkout.scan}
              className="h-56 w-56"
              // The SVG is generated on this server from the payload, never from
              // user input, so there is nothing untrusted to inject here.
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server-generated QR SVG
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          </div>
          <p className="text-center text-sm text-white/60">{copy.checkout.scan}</p>

          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-wide text-white/55">
              {copy.checkout.copyPaste}
            </p>
            <code
              data-testid="checkout-copy-paste"
              className="select-all break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 font-mono text-xs text-white/70"
            >
              {checkout.copyPaste}
            </code>
            <button
              type="button"
              onClick={copyCode}
              data-testid="checkout-copy-button"
              className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-neutral-950"
            >
              {copied ? copy.checkout.copied : copy.checkout.copy}
            </button>
          </div>

          <p data-testid="checkout-waiting" className="text-sm text-white/70">
            {copy.checkout.waiting}
          </p>
          <p className="text-xs text-white/55">{copy.checkout.waitingHint}</p>
          <p className="text-xs text-white/55">
            {remaining > 0
              ? copy.checkout.expiresAt(formatDuration(remaining))
              : copy.checkout.expired}
          </p>
        </>
      )}

      <a href="/" className="text-sm font-semibold text-amber-300 underline">
        {copy.checkout.backToRanking}
      </a>
    </main>
  );
}

function BoostSuccess({
  checkout,
  status,
}: {
  readonly checkout: CheckoutDto;
  readonly status: PaymentStatusResponseDto;
}) {
  const [shared, setShared] = useState(false);
  const movement = status.movement;
  const handle = checkout.creatorSlug;

  // The movement shown is the one that actually happened, computed from the
  // ranking after confirmation — never the quote the customer saw.
  const successLine =
    movement === null
      ? null
      : movement.fromRank === null
        ? copy.success.enteredRanking(movement.toRank)
        : copy.boost.success(
            handle,
            formatBrl(checkout.amountCents),
            movement.fromRank,
            movement.toRank,
          );

  const shareText =
    movement === null || movement.fromRank === null
      ? `Eu impulsionei @${handle}. 🔥 Quem leva ao #1?`
      : copy.boost.share(handle, movement.fromRank, movement.toRank);

  const handleShare = async () => {
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({
          title: `Creator Outdoor — @${handle}`,
          text: shareText,
          url: `${window.location.origin}/criador/${handle}`,
        });
        setShared(true);
        setTimeout(() => setShared(false), 2500);
        return;
      }
    } catch {
      // User cancelled share sheet or share unsupported; fallback to clipboard
    }

    try {
      if (typeof navigator !== "undefined" && "clipboard" in navigator) {
        await navigator.clipboard.writeText(shareText);
        setShared(true);
        setTimeout(() => setShared(false), 2500);
      }
    } catch {
      setShared(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2 rounded-2xl border border-amber-400/30 bg-gradient-to-b from-amber-400/10 to-transparent p-6 text-center shadow-lg shadow-amber-500/5">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-400/20 text-3xl">
          🎉
        </span>
        <h1 data-testid="boost-success" className="text-2xl font-black tracking-tight text-white">
          {copy.success.title}
        </h1>
        {successLine === null ? null : (
          <p data-testid="boost-movement" className="text-lg font-bold text-amber-300">
            {successLine}
          </p>
        )}
        <p className="text-sm text-white/70">
          {checkout.creatorDisplayName} · {formatBrl(checkout.amountCents)}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          data-testid="boost-share"
          onClick={handleShare}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3.5 text-base font-black uppercase tracking-wide text-neutral-950 transition hover:bg-amber-300"
        >
          <span>📲</span>
          <span>{shared ? copy.success.shareCopied : copy.success.share}</span>
        </button>

        <a
          href={`/criador/${checkout.creatorSlug}`}
          className="flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          {copy.success.seeProfile}
        </a>

        <a href="/" className="text-center text-xs text-white/50 underline hover:text-white/80">
          {copy.checkout.backToRanking}
        </a>
      </div>
    </main>
  );
}
