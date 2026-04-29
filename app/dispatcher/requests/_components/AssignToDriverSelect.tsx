"use client";

import { assignRequestToDriverAction } from "../actions";

export interface DriverOption {
  /** drivers.profile_id */
  driverId: string;
  /** Driver display name. */
  fullName: string;
  /**
   * Short hint: e.g. "4 stops today" or "no route yet". Derived
   * server-side from the driver's existing today-route status.
   */
  hint: string;
}

interface AssignToDriverSelectProps {
  requestId: string;
  drivers: DriverOption[];
}

export function AssignToDriverSelect({
  requestId,
  drivers,
}: AssignToDriverSelectProps) {
  if (drivers.length === 0) {
    return (
      <span className="text-xs text-gray-500">
        No active drivers configured.
      </span>
    );
  }

  const boundAction = assignRequestToDriverAction.bind(null, requestId);

  return (
    <form action={boundAction} className="mini-form inline-flex items-center gap-1">
      <select
        name="driverId"
        defaultValue=""
        required
        className="text-xs"
        aria-label="Assign to driver"
      >
        <option value="" disabled>
          Assign to driver
        </option>
        {drivers.map((d) => (
          <option key={d.driverId} value={d.driverId}>
            {d.fullName} · {d.hint}
          </option>
        ))}
      </select>
      <button type="submit" className="text-xs">
        Go
      </button>
    </form>
  );
}
