export type PickupFormState =
  | { status: "idle"; error: null; fieldErrors: Record<string, never> }
  | {
      status: "error";
      error: string | null;
      fieldErrors: Partial<Record<"notes" | "urgency" | "sampleCount", string>>;
    }
  | { status: "ok"; requestId: string; etaText: string };

export const INITIAL_PICKUP_FORM_STATE: PickupFormState = {
  status: "idle",
  error: null,
  fieldErrors: {},
};
