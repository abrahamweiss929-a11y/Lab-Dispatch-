"use client";

import { useFormState } from "react-dom";
import { INITIAL_PICKUP_FORM_STATE } from "../form-state";
import { submitPickupRequestAction } from "../actions";

interface PickupRequestFormProps {
  slugToken: string;
  officeName: string;
  officeCity: string;
  officeState: string;
  officePhone?: string;
}

export function PickupRequestForm({
  slugToken,
  officeName,
  officeCity,
  officeState,
  officePhone,
}: PickupRequestFormProps) {
  const [state, formAction] = useFormState(
    submitPickupRequestAction,
    INITIAL_PICKUP_FORM_STATE,
  );

  if (state?.status === "ok") {
    return (
      <section className="rounded border border-green-200 bg-green-50 p-6">
        <h1 className="text-2xl font-bold tracking-tight text-green-900">
          Thanks — request received
        </h1>
        <p className="mt-3 text-sm text-gray-800">
          A driver will be by {state?.etaText}.
        </p>
        {officePhone !== undefined && officePhone.length > 0 ? (
          <p className="mt-2 text-sm text-gray-800">
            If this is urgent, call us at {officePhone}.
          </p>
        ) : (
          <p className="mt-2 text-sm text-gray-800">
            If this is urgent, please contact the lab directly.
          </p>
        )}
      </section>
    );
  }

  const error = state?.status === "error" ? state?.error : null;
  const fieldErrors =
    state?.status === "error" ? state?.fieldErrors : ({} as const);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Request sample pickup — {officeName}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {officeCity}, {officeState}. You&apos;re identified as this office by
          this link — no login required.
        </p>
      </header>

      {error !== null ? (
        <p
          role="alert"
          className="rounded bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <input type="hidden" name="slugToken" value={slugToken} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Notes</span>
        <textarea
          name="notes"
          maxLength={1000}
          rows={4}
          className="rounded border border-gray-300 px-3 py-2"
          placeholder="What are we picking up? (patient count, sample type, any special instructions)"
        />
        {"notes" in fieldErrors && fieldErrors.notes ? (
          <span className="text-xs text-red-600">{fieldErrors.notes}</span>
        ) : null}
      </label>

      <fieldset className="space-y-2 rounded border border-gray-200 p-4">
        <legend className="px-1 text-sm font-medium">Urgency</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="urgency"
            value="routine"
            defaultChecked
          />
          <span>Routine</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="urgency" value="urgent" />
          <span>Urgent</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="urgency" value="stat" />
          <span>Stat</span>
        </label>
        {"urgency" in fieldErrors && fieldErrors.urgency ? (
          <span className="block text-xs text-red-600">
            {fieldErrors.urgency}
          </span>
        ) : null}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Sample count (optional)</span>
        <input
          type="number"
          name="sampleCount"
          min={1}
          max={99}
          step={1}
          className="rounded border border-gray-300 px-3 py-2"
        />
        {"sampleCount" in fieldErrors && fieldErrors.sampleCount ? (
          <span className="text-xs text-red-600">
            {fieldErrors.sampleCount}
          </span>
        ) : null}
      </label>

      <button
        type="submit"
        className="w-full rounded bg-black px-4 py-3 text-sm font-medium text-white hover:bg-gray-800"
      >
        Send pickup request
      </button>
    </form>
  );
}
