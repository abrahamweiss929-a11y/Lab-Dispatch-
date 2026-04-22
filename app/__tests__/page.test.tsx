import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "@/app/page";

describe("Home page", () => {
  it("renders the Lab Dispatch heading", () => {
    render(<Page />);
    const heading = screen.getByRole("heading", { name: /lab dispatch/i });
    expect(heading).toBeInTheDocument();
  });
});
