"use client";

import {
  completeRouteAction,
  resetRouteAction,
  startRouteAction,
} from "../../actions";
import type { RouteStatus } from "@/lib/types";

interface RouteStatusControlsProps {
  routeId: string;
  status: RouteStatus;
}

export function RouteStatusControls({
  routeId,
  status,
}: RouteStatusControlsProps) {
  const boundStart = startRouteAction.bind(null, routeId);
  const boundComplete = completeRouteAction.bind(null, routeId);
  const boundReset = resetRouteAction.bind(null, routeId);

  return (
    <div className="flex flex-wrap gap-2">
      {status === "pending" ? (
        <form action={boundStart}>
          <button
            type="submit"
            className="btn btn-primary min-h-9 px-3 py-1 text-xs"
          >
            Start route
          </button>
        </form>
      ) : null}
      {status === "active" ? (
        <form action={boundComplete}>
          <button
            type="submit"
            className="btn btn-success min-h-9 px-3 py-1 text-xs"
          >
            Complete route
          </button>
        </form>
      ) : null}
      {status !== "pending" ? (
        <form action={boundReset}>
          <button
            type="submit"
            className="btn btn-secondary min-h-9 px-3 py-1 text-xs"
          >
            Reset to pending
          </button>
        </form>
      ) : null}
    </div>
  );
}
