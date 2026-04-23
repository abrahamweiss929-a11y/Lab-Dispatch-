import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock `next/navigation` so `redirect` (imported by app/page.tsx) is inert
// when the component is called with an active session in other tests. Here
// we only exercise the unauthenticated branch.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect called with ${url}`);
  },
}));

// Stub `getSession` so the server component under test can run in jsdom
// without a real Next request scope (the production `getSession` is async
// and calls `cookies()` from `next/headers`, which requires a request).
vi.mock("@/lib/session", () => ({
  getSession: async () => null,
  SESSION_COOKIE: "ld_session",
  LD_ROLE_COOKIE: "ld_role",
}));

import Page from "@/app/page";

describe("Home page", () => {
  it("renders the Lab Dispatch heading for unauthenticated visitors", async () => {
    render(await Page());
    const heading = screen.getByRole("heading", { name: /lab dispatch/i });
    expect(heading).toBeInTheDocument();
  });

  it("renders a Sign in link when not authenticated", async () => {
    render(await Page());
    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link).toHaveAttribute("href", "/login");
  });
});
