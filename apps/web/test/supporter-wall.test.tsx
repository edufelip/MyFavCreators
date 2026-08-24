import { describe, expect, test } from "bun:test";
import type { TorcidaDto, TorcidaEntryDto } from "@creator-outdoor/contracts";
import { render, screen } from "@testing-library/react";
import { SupporterWall } from "../src/components/supporter-wall";

function entry(overrides: Partial<TorcidaEntryDto> = {}): TorcidaEntryDto {
  return {
    id: "a".repeat(64),
    supporterName: "Ana",
    message: null,
    anonymous: false,
    amountCents: 5_000,
    boostCount: 1,
    lastBoostAt: "2026-08-19T11:00:00.000Z",
    ...overrides,
  };
}

function wall(overrides: Partial<TorcidaDto> = {}): TorcidaDto {
  return {
    creatorSlug: "luna-verso",
    window: "all-time",
    entries: [entry()],
    supporterCount: 1,
    totalAmountCents: 5_000,
    total: 1,
    ...overrides,
  };
}

describe("the supporter wall", () => {
  test("shows each supporter with what they put in", () => {
    render(
      <SupporterWall
        torcida={wall({
          entries: [
            entry({ supporterName: "Ana", amountCents: 9_000, message: "vamos!" }),
            entry({ id: "b".repeat(64), supporterName: "Bia", amountCents: 1_000 }),
          ],
          supporterCount: 2,
          total: 2,
        })}
      />,
    );

    expect(screen.getByText("Ana")).toBeDefined();
    expect(screen.getByText("vamos!")).toBeDefined();
    expect(screen.getByText("R$90")).toBeDefined();
    expect(screen.getByText("Bia")).toBeDefined();
    expect(screen.getByText("2 pessoas na torcida")).toBeDefined();
  });

  test("labels an anonymous supporter without inventing a name", () => {
    render(
      <SupporterWall
        torcida={wall({ entries: [entry({ supporterName: null, anonymous: true })] })}
      />,
    );

    expect(screen.getByText("Anônimo")).toBeDefined();
    expect(screen.queryByText("Ana")).toBeNull();
    expect(screen.getByTestId("supporter-entry").getAttribute("data-anonymous")).toBe("true");
  });

  test("shows how many boosts a repeat supporter made, and stays quiet about one", () => {
    render(<SupporterWall torcida={wall({ entries: [entry({ boostCount: 3 })] })} />);
    expect(screen.getByText("3 impulsos")).toBeDefined();

    render(<SupporterWall torcida={wall()} />);
    expect(screen.queryByText("1 impulso")).toBeNull();
  });

  test("invites the first supporter when nobody has boosted yet", () => {
    render(
      <SupporterWall
        torcida={wall({ entries: [], supporterCount: 0, totalAmountCents: 0, total: 0 })}
      />,
    );
    expect(screen.getByTestId("supporter-wall-empty")).toBeDefined();
    expect(screen.queryAllByTestId("supporter-entry")).toHaveLength(0);
  });

  test("says how many supporters the page did not have room for", () => {
    render(<SupporterWall torcida={wall({ supporterCount: 40, total: 40 })} />);
    expect(screen.getByText("e mais 39")).toBeDefined();
  });

  test("never renders a message as markup", () => {
    // A supporter message is arbitrary text from the public internet.
    render(
      <SupporterWall
        torcida={wall({ entries: [entry({ message: "<img src=x onerror=alert(1)>" })] })}
      />,
    );
    const item = screen.getByTestId("supporter-entry");
    expect(item.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeDefined();
  });
});
