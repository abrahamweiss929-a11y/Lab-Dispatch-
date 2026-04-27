import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// `useFormState` is a server-action-aware hook that doesn't work in a
// plain JSDOM test without a Next.js runtime. Stub it to a trivial
// `[state, noopAction]` shape — we only care about the rendered <select>
// options here, not the form submission flow (which is covered by
// app/admin/users/actions.test.ts).
vi.mock("react-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    useFormState: <S, P>(_action: unknown, initial: S): [S, (p: P) => void] => [
      initial,
      () => {},
    ],
    useFormStatus: () => ({ pending: false, data: null, method: null, action: null }),
  };
});

import { InviteForm } from "./InviteForm";

/**
 * Smoke test asserting the unified invite form has exactly two role
 * options: "Office staff" and "Driver". Post the 2026-04-27 unification
 * "dispatcher" is no longer offered as an invite role — every back-office
 * invitee gets 'office'.
 */
describe("InviteForm — role options", () => {
  it("offers exactly 'Office staff' and 'Driver', no 'Dispatcher'", () => {
    render(<InviteForm />);
    const select = screen.getByLabelText(/role/i) as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) =>
      o.textContent?.trim(),
    );
    const optionValues = Array.from(select.options).map((o) => o.value);

    expect(optionTexts).toEqual(["Office staff", "Driver"]);
    expect(optionValues).toEqual(["office", "driver"]);
    expect(select.value).toBe("office");
  });
});
