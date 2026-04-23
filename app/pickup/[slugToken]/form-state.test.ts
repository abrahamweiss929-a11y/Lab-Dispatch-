import { describe, it, expect } from "vitest";
import {
  INITIAL_PICKUP_FORM_STATE,
  type PickupFormState,
} from "./form-state";
import * as actionsModule from "./actions";

describe("form-state", () => {
  it("INITIAL_PICKUP_FORM_STATE has status idle with empty errors", () => {
    expect(INITIAL_PICKUP_FORM_STATE.status).toBe("idle");
    expect((INITIAL_PICKUP_FORM_STATE as { error: null }).error).toBeNull();
  });

  it("INITIAL_PICKUP_FORM_STATE satisfies PickupFormState type", () => {
    const state: PickupFormState = INITIAL_PICKUP_FORM_STATE;
    expect(state).toBeDefined();
  });
});

describe("actions module exports only async functions (use server boundary)", () => {
  it("every runtime export of actions.ts is an async function", () => {
    for (const [key, value] of Object.entries(actionsModule)) {
      expect(
        typeof value === "function" && value.constructor.name === "AsyncFunction",
        `export "${key}" must be an async function, got ${typeof value} (${
          typeof value === "function" ? value.constructor.name : "n/a"
        })`,
      ).toBe(true);
    }
  });
});
