import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { BoostDisclosure } from "../src/components/boost-disclosure";
import { copy } from "../src/lib/copy";

const REQUIRED_TEXT =
  "Você está comprando destaque nesta plataforma. Nenhum valor é repassado ao criador.";

describe("BoostDisclosure", () => {
  test("renders the mandatory sentence verbatim", () => {
    render(<BoostDisclosure />);
    expect(screen.getByTestId("boost-disclosure").textContent).toBe(REQUIRED_TEXT);
  });

  test("keeps the copy bank in sync with the mandated wording", () => {
    expect(copy.disclosure).toBe(REQUIRED_TEXT);
  });

  test("is visible rather than hidden, collapsed or behind a tooltip", () => {
    render(<BoostDisclosure />);
    const element = screen.getByTestId("boost-disclosure");
    expect(element.hasAttribute("hidden")).toBe(false);
    expect(element.getAttribute("aria-hidden")).toBeNull();
    expect(element.getAttribute("title")).toBeNull();
    expect(element.tagName).toBe("P");
  });
});
