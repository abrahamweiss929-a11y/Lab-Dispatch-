"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { createRouteAction } from "../../actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";
import type { PickupUrgency } from "@/lib/types";

interface DriverOption {
  profileId: string;
  fullName: string;
}

export interface PendingRequestOption {
  id: string;
  senderLabel: string;
  urgency: PickupUrgency;
  sampleCount?: number;
}

interface NewRouteFormProps {
  drivers: DriverOption[];
  defaultDate: string;
  pendingRequests: PendingRequestOption[];
}

const URGENCY_BADGE: Record<PickupUrgency, string> = {
  routine: "badge badge-neutral",
  urgent: "badge badge-warning",
  stat: "badge badge-danger",
};

export function NewRouteForm({
  drivers,
  defaultDate,
  pendingRequests,
}: NewRouteFormProps) {
  const [state, formAction] = useFormState(
    createRouteAction,
    INITIAL_ADMIN_FORM_STATE,
  );

  return (
    <form action={formAction} className="form-card space-y-4" noValidate>
      {state?.error ? (
        <p role="alert" className="alert-error">
          {state?.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Driver</span>
        <select
          name="driverId"
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
          defaultValue={defaultDate}
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.routeDate ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.routeDate}
          </span>
        ) : null}
      </label>

      <fieldset className="form-row">
        <legend className="font-medium text-sm mb-2">
          Pending pickup requests (optional)
        </legend>
        {pendingRequests.length === 0 ? (
          <p className="empty-state text-sm">
            No pending requests right now. You can still create the route
            and add stops later.
          </p>
        ) : (
          <ul className="space-y-2 max-h-64 overflow-y-auto rounded border border-gray-200 p-2">
            {pendingRequests.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  id={`req-${r.id}`}
                  name="requestIds"
                  value={r.id}
                  className="h-4 w-4"
                />
                <label
                  htmlFor={`req-${r.id}`}
                  className="flex flex-1 items-center gap-2 text-sm cursor-pointer"
                >
                  <span className="font-medium">{r.senderLabel}</span>
                  {typeof r.sampleCount === "number" ? (
                    <span className="text-xs text-gray-500">
                      · {r.sampleCount} sample{r.sampleCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <span className={`${URGENCY_BADGE[r.urgency]} ml-auto`}>
                    {r.urgency}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="form-actions">
        <button type="submit">Create route</button>
        <Link
          href="/dispatcher/routes"
          className="px-4 py-2 text-sm hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
