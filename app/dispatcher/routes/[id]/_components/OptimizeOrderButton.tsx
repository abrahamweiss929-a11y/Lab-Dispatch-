"use client";

import { useState, useTransition } from "react";
import {
  optimizeRouteAction,
  type OptimizeRouteActionResult,
} from "../../actions";

interface OptimizeOrderButtonProps {
  routeId: string;
  /** Disable when route is past, completed, etc. */
  disabled?: boolean;
}

const TONE_BY_STATUS: Record<
  OptimizeRouteActionResult["status"],
  "success" | "info" | "warning" | "error"
> = {
  reordered: "success",
  already_optimal: "info",
  not_enough_stops: "info",
  missing_coordinates: "warning",
  unavailable: "error",
};

export function OptimizeOrderButton({
  routeId,
  disabled,
}: OptimizeOrderButtonProps) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{
    tone: "success" | "info" | "warning" | "error";
    message: string;
  } | null>(null);

  function handleClick() {
    setToast(null);
    startTransition(async () => {
      try {
        const result = await optimizeRouteAction(routeId);
        setToast({ tone: TONE_BY_STATUS[result.status], message: result.message });
      } catch (err) {
        setToast({
          tone: "error",
          message: err instanceof Error ? err.message : "Could not optimize.",
        });
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        className="btn btn-secondary disabled:opacity-60"
      >
        {pending ? "Optimizing…" : "Optimize order"}
      </button>
      {toast ? (
        <p
          role="status"
          className={
            toast.tone === "success"
              ? "alert-success mt-2 text-sm"
              : toast.tone === "warning"
                ? "alert-warning mt-2 text-sm"
                : toast.tone === "error"
                  ? "alert-error mt-2 text-sm"
                  : "alert-info mt-2 text-sm"
          }
        >
          {toast.message}
        </p>
      ) : null}
    </div>
  );
}
