"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { createManualRequestAction } from "../../actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";

interface OfficeOption {
  id: string;
  name: string;
}

interface NewManualRequestFormProps {
  offices: OfficeOption[];
}

export function NewManualRequestForm({ offices }: NewManualRequestFormProps) {
  const [state, formAction] = useFormState(
    createManualRequestAction,
    INITIAL_ADMIN_FORM_STATE,
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error ? (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {state?.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Office</span>
        <select
          name="officeId"
          required
          defaultValue=""
          className="rounded border border-gray-300 px-3 py-2"
        >
          <option value="" disabled>
            Choose an office
          </option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.officeId ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.officeId}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Urgency</span>
        <select
          name="urgency"
          required
          defaultValue="routine"
          className="rounded border border-gray-300 px-3 py-2"
        >
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="stat">Stat</option>
        </select>
        {state?.fieldErrors?.urgency ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.urgency}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Sample count (optional)</span>
        <input
          type="number"
          name="sampleCount"
          min="1"
          step="1"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.sampleCount ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.sampleCount}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Special instructions (optional)</span>
        <textarea
          name="specialInstructions"
          rows={3}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create request
        </button>
        <Link
          href="/dispatcher/requests"
          className="rounded px-4 py-2 text-sm text-gray-600 hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
