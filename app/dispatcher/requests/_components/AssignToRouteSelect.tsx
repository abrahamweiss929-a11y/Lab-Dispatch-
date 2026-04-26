"use client";

import Link from "next/link";
import { assignRequestToRouteAction } from "../actions";

interface RouteOption {
  id: string;
  label: string;
}

interface AssignToRouteSelectProps {
  requestId: string;
  routes: RouteOption[];
}

export function AssignToRouteSelect({
  requestId,
  routes,
}: AssignToRouteSelectProps) {
  if (routes.length === 0) {
    return (
      <span className="text-xs text-gray-500">
        No routes today —{" "}
        <Link
          href="/dispatcher/routes/new"
          className="btn-link"
        >
          create one
        </Link>
      </span>
    );
  }

  const boundAction = assignRequestToRouteAction.bind(null, requestId);

  return (
    <form action={boundAction} className="mini-form inline-flex items-center gap-1">
      <select
        name="routeId"
        defaultValue=""
        required
        className="text-xs"
      >
        <option value="" disabled>
          Assign to route
        </option>
        {routes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="text-xs"
      >
        Go
      </button>
    </form>
  );
}
