import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteSummaryCard } from "./RouteSummaryCard";

describe("RouteSummaryCard", () => {
  it("renders nothing when no remaining stops", () => {
    const { container } = render(
      <RouteSummaryCard
        remainingStops={0}
        driveMinutes={0}
        pickupMinutes={0}
        finishLabel="—"
        fromGoogle={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the summary line and finish-by label with traffic note when fromGoogle", () => {
    render(
      <RouteSummaryCard
        remainingStops={3}
        driveMinutes={42}
        pickupMinutes={21}
        finishLabel="2:15 PM"
        fromGoogle={true}
        fullRouteUrl="https://example.com/route"
      />,
    );
    expect(screen.getByText(/3 stops/)).toBeTruthy();
    expect(screen.getByText(/~42m drive \+ 21m pickup/)).toBeTruthy();
    expect(screen.getByText("2:15 PM")).toBeTruthy();
    expect(screen.getByText("(with traffic)")).toBeTruthy();
    const link = screen.getByRole("link", {
      name: /Open full route in Google Maps/i,
    });
    expect(link.getAttribute("href")).toBe("https://example.com/route");
  });

  it("singular stop word + estimate label when not fromGoogle and no link", () => {
    render(
      <RouteSummaryCard
        remainingStops={1}
        driveMinutes={12}
        pickupMinutes={7}
        finishLabel="3:00 PM"
        fromGoogle={false}
      />,
    );
    expect(screen.getByText(/1 stop /)).toBeTruthy();
    expect(screen.getByText("(estimate)")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
