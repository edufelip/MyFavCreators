import { describe, expect, test } from "bun:test";
import type { LeaderboardEntryDto } from "@creator-outdoor/contracts";
import { render, screen, within } from "@testing-library/react";
import { Billboard } from "../src/components/billboard";
import { CreatorCard } from "../src/components/creator-card";
import { Leaderboard } from "../src/components/leaderboard";

function entry(overrides: Partial<LeaderboardEntryDto> = {}): LeaderboardEntryDto {
  return {
    rank: 1,
    creator: {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "luna-verso",
      displayName: "Luna Verso",
      avatarUrl: null,
      category: { slug: "musica", name: "Música" },
      primaryPlatform: "YOUTUBE",
      primaryHandle: "@lunaverso",
    },
    amountCents: 48_700,
    supporterCount: 47,
    reachedCurrentScoreAt: "2026-08-19T11:00:00.000Z",
    takeFirstPlaceAmountCents: null,
    ...overrides,
  };
}

function challenger(): LeaderboardEntryDto {
  return entry({
    rank: 2,
    creator: {
      id: "22222222-2222-4222-8222-222222222222",
      slug: "mara-beats",
      displayName: "Mara Beats",
      avatarUrl: null,
      category: { slug: "musica", name: "Música" },
      primaryPlatform: "SPOTIFY",
      primaryHandle: "marabeats",
    },
    amountCents: 39_300,
    supporterCount: 1,
    takeFirstPlaceAmountCents: 9_500,
  });
}

describe("CreatorCard", () => {
  test("shows rank, creator, category, platform and the weekly amount", () => {
    render(
      <ul>
        <CreatorCard entry={entry({ rank: 4, amountCents: 28_600 })} tab="weekly" />
      </ul>,
    );
    const card = screen.getByTestId("creator-card");
    expect(within(card).getByText("#4")).toBeDefined();
    expect(within(card).getByText("Luna Verso")).toBeDefined();
    expect(within(card).getByText("@lunaverso")).toBeDefined();
    const category = within(card).getByTestId("creator-category-link");
    expect(category.textContent).toBe("Música");
    // The category is a way in, not just a label: it is how somebody finds the
    // other creators they would never have scrolled far enough to see.
    expect(category.getAttribute("href")).toBe("/categoria/musica");
    expect(within(card).getByText(/YouTube/)).toBeDefined();
    expect(within(card).getByText("R$286 impulsionados esta semana")).toBeDefined();
    expect(within(card).getByText("47 impulsionadores")).toBeDefined();
  });

  test("labels the general ranking as a total rather than as this week", () => {
    render(
      <ul>
        <CreatorCard entry={entry({ amountCents: 258_200 })} tab="all-time" />
      </ul>,
    );
    expect(screen.getByText("R$2.582 impulsionados no total")).toBeDefined();
    expect(screen.queryByText(/esta semana/)).toBeNull();
  });

  test("renders the Take #1 quote for a creator who is not #1", () => {
    render(
      <ul>
        <CreatorCard entry={challenger()} tab="weekly" />
      </ul>,
    );
    expect(screen.getByTestId("take-first-place").textContent).toBe("Assuma o #1 por R$95");
  });

  test("hides the Take #1 quote for the current leader", () => {
    render(
      <ul>
        <CreatorCard entry={entry()} tab="weekly" />
      </ul>,
    );
    expect(screen.queryByTestId("take-first-place")).toBeNull();
  });

  test("uses the singular for a creator with a single supporter", () => {
    render(
      <ul>
        <CreatorCard entry={challenger()} tab="weekly" />
      </ul>,
    );
    expect(screen.getByText("1 impulsionador")).toBeDefined();
  });

  test("falls back to initials when a creator has no avatar", () => {
    render(
      <ul>
        <CreatorCard entry={entry()} tab="weekly" />
      </ul>,
    );
    expect(screen.getByText("LV")).toBeDefined();
  });
});

describe("Billboard", () => {
  test("gives the weekly leader the dominant placement", () => {
    render(<Billboard leader={entry()} />);
    const billboard = screen.getByTestId("billboard");
    expect(within(billboard).getByText("#1 desta semana")).toBeDefined();
    expect(within(billboard).getByRole("heading", { level: 1 }).textContent).toBe("Luna Verso");
    expect(within(billboard).getByText("R$487")).toBeDefined();
    expect(within(billboard).getByText("Música · YouTube")).toBeDefined();
    expect(within(billboard).getByText(/47 impulsionadores/)).toBeDefined();
    // The call to action is a real link into the creator's boost area, not a
    // disabled placeholder.
    const cta = within(billboard).getByTestId("billboard-boost-cta");
    expect(cta.textContent).toBe("IMPULSIONAR");
    expect(cta.getAttribute("href")).toBe("/criador/luna-verso#impulsionar");
  });

  test("renders heat mode urgency badge when heatMode is active", () => {
    render(<Billboard leader={entry()} heatMode={true} />);
    const billboard = screen.getByTestId("billboard");
    expect(within(billboard).getByText("DECIDE HOJE")).toBeDefined();
  });
});

describe("Leaderboard", () => {
  test("offers both rankings and defaults the selection to this week", () => {
    render(<Leaderboard tab="weekly" entries={[entry(), challenger()]} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Esta semana", "Geral"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
  });

  test("marks the general ranking as selected when it is being shown", () => {
    render(<Leaderboard tab="all-time" entries={[entry()]} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
  });

  test("renders one card per creator, in the order the API returned them", () => {
    render(<Leaderboard tab="weekly" entries={[entry(), challenger()]} />);
    const cards = screen.getAllByTestId("creator-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("Luna Verso");
    expect(cards[1]?.textContent).toContain("Mara Beats");
  });

  test("explains an empty week instead of rendering nothing", () => {
    render(<Leaderboard tab="weekly" entries={[]} />);
    expect(screen.getByText("Nenhum perfil impulsionado ainda nesta semana.")).toBeDefined();
  });

  test("says so when the ranking cannot be loaded", () => {
    render(<Leaderboard tab="weekly" entries={[]} unavailable />);
    expect(
      screen.getByText("O ranking está indisponível no momento. Tente novamente em instantes."),
    ).toBeDefined();
  });
});
