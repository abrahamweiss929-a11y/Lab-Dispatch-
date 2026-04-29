import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { LocalDateTime } from "./LocalDateTime";

describe("LocalDateTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin "now" to a stable instant so the relative-form math is
    // deterministic. 2026-04-29 12:00:00 UTC.
    vi.setSystemTime(new Date("2026-04-29T12:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders an empty time element on first paint, then fills in the local-tz string", async () => {
    const { container } = render(
      <LocalDateTime iso="2026-04-29T11:30:00Z" />,
    );
    // Element exists with the dateTime + title attrs even before useEffect.
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("dateTime")).toBe("2026-04-29T11:30:00Z");
    expect(time?.getAttribute("title")).toBe("2026-04-29T11:30:00Z");

    // Flush effects.
    await act(async () => {
      await Promise.resolve();
    });

    // After mount the text is non-empty.
    expect(time?.textContent ?? "").not.toBe("");
  });

  it("renders '—' for an unparseable ISO", async () => {
    const { container } = render(<LocalDateTime iso="not a date" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("time")?.textContent).toBe("—");
  });

  it("relative form: 'just now' for very recent, 'X minutes ago' for <1h, 'X hours ago' for <24h", async () => {
    // 30s ago → "just now"
    const recent = new Date("2026-04-29T11:59:30Z").toISOString();
    const r1 = render(<LocalDateTime iso={recent} style="relative" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(r1.container.querySelector("time")?.textContent).toBe("just now");
    cleanup();

    // 5 min ago.
    const fiveAgo = new Date("2026-04-29T11:55:00Z").toISOString();
    const r2 = render(<LocalDateTime iso={fiveAgo} style="relative" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(r2.container.querySelector("time")?.textContent).toBe(
      "5 minutes ago",
    );
    cleanup();

    // 3h ago.
    const threeAgo = new Date("2026-04-29T09:00:00Z").toISOString();
    const r3 = render(<LocalDateTime iso={threeAgo} style="relative" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(r3.container.querySelector("time")?.textContent).toBe(
      "3 hours ago",
    );
  });

  it("relative form falls back to short for items >= 24h old", async () => {
    // Two days ago → falls back to short form, which won't match
    // "X hours ago" or "X minutes ago".
    const old = new Date("2026-04-27T11:00:00Z").toISOString();
    const r = render(<LocalDateTime iso={old} style="relative" />);
    await act(async () => {
      await Promise.resolve();
    });
    const text = r.container.querySelector("time")?.textContent ?? "";
    expect(text).not.toMatch(/ago$/);
    expect(text.length).toBeGreaterThan(0);
  });
});
