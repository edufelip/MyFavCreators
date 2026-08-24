import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import AdminHomePage from "../src/app/page";
import { adminCopy } from "../src/lib/copy";

describe("admin placeholder", () => {
  test("renders the Phase 1 placeholder", () => {
    render(<AdminHomePage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(adminCopy.placeholder.title);
  });

  test("states the boundary the admin app must preserve", () => {
    render(<AdminHomePage />);
    expect(screen.getByText(adminCopy.placeholder.boundary)).toBeDefined();
  });
});
