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
    <div className="flex gap-2">
      {status === "pending" ? (
        <form action={boundStart}>
          <button
            type="submit"
            className="rounded bg-black px-3 py-1 text-xs font-medium text-white hover:bg-gray-800"
          >
            Start route
          </button>
        </form>
      ) : null}
      {status === "active" ? (
        <form action={boundComplete}>
          <button
            type="submit"
            className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800"
          >
            Complete route
          </button>
        </form>
      ) : null}
      {status !== "pending" ? (
        <form action={boundReset}>
          <button
            type="submit"
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
          >
            Reset to pending
          </button>
        </form>
      ) : null}
    </div>
  );
}
