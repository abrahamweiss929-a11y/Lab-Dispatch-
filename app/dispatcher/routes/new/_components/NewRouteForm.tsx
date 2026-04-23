"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { createRouteAction } from "../../actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";

interface DriverOption {
  profileId: string;
  fullName: string;
}

interface NewRouteFormProps {
  drivers: DriverOption[];
  defaultDate: string;
}

export function NewRouteForm({ drivers, defaultDate }: NewRouteFormProps) {
  const [state, formAction] = useFormState(
    createRouteAction,
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
        <span className="font-medium">Driver</span>
        <select
          name="driverId"
          required
          defaultValue=""
          className="rounded border border-gray-300 px-3 py-2"
        >
          <option value="" disabled>
            Choose a driver
          </option>
          {drivers.map((d) => (
            <option key={d.profileId} value={d.profileId}>
              {d.fullName}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.driverId ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.driverId}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Date</span>
        <input
          type="date"
          name="routeDate"
          required
          defaultValue={defaultDate}
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.routeDate ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.routeDate}
          </span>
        ) : null}
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create route
        </button>
        <Link
          href="/dispatcher/routes"
          className="rounded px-4 py-2 text-sm text-gray-600 hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
