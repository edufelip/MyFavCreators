import { describe, expect, test } from "bun:test";
import type { CheckoutDto, PaymentStatusResponseDto } from "@creator-outdoor/contracts";
import { render, screen } from "@testing-library/react";
import { CheckoutView } from "../src/components/checkout-view";

describe("CheckoutView", () => {
  const dummyCheckout: CheckoutDto = {
    paymentId: "11111111-1111-1111-1111-111111111111",
    boostId: "22222222-2222-2222-2222-222222222222",
    creatorSlug: "mara-beats",
    creatorDisplayName: "Mara Beats",
    amountCents: 5000,
    qrCode: "00020126580014br.gov.bcb.pix...",
    copyPaste: "00020126580014br.gov.bcb.pix...",
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    origin: "DIRECT",
    status: "PENDING",
  };

  const pendingStatus: PaymentStatusResponseDto = {
    paymentId: dummyCheckout.paymentId,
    status: "PENDING",
    boostStatus: "PENDING",
    creatorSlug: dummyCheckout.creatorSlug,
    amountCents: dummyCheckout.amountCents,
    movement: null,
    confirmedAt: null,
    supporterCount: 1,
  };

  const confirmedStatus: PaymentStatusResponseDto = {
    paymentId: dummyCheckout.paymentId,
    status: "CONFIRMED",
    boostStatus: "ACTIVE",
    creatorSlug: dummyCheckout.creatorSlug,
    amountCents: dummyCheckout.amountCents,
    movement: {
      fromRank: 4,
      toRank: 1,
      positionsGained: 3,
      direction: "UP",
    },
    confirmedAt: new Date().toISOString(),
    supporterCount: 2,
  };

  test("renders checkout screen with QR code, copy-paste and disclosure", () => {
    render(
      <CheckoutView
        checkout={dummyCheckout}
        initialStatus={pendingStatus}
        qrSvg="<svg><rect width='100' height='100'/></svg>"
      />,
    );

    expect(screen.getByTestId("checkout-copy-button")).toBeDefined();
    expect(screen.getByTestId("checkout-copy-paste")).toBeDefined();
    expect(screen.getByText(/Mara Beats/)).toBeDefined();
  });

  test("renders celebratory success screen when status is CONFIRMED", () => {
    render(
      <CheckoutView checkout={dummyCheckout} initialStatus={confirmedStatus} qrSvg="<svg></svg>" />,
    );

    expect(screen.getByTestId("boost-success")).toBeDefined();
    expect(screen.getByTestId("boost-movement")).toBeDefined();
    expect(screen.getByTestId("boost-share")).toBeDefined();
  });
});
