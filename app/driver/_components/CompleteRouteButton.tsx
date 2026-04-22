"use client";

import { useFormStatus } from "react-dom";
import { completeRouteAction } from "../actions";

interface CompleteRouteButtonProps {
  routeId: string;
  disabled?: boolean;
}

function SubmitButton({ forceDisabled }: { forceDisabled: boolean }) {
  const { pending } = useFormStatus();
  const disabled = pending || forceDisabled;
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-xl bg-green-700 py-4 text-lg font-semibold text-white shadow hover:bg-green-800 disabled:opacity-60"
    >
      {pending ? "Completing…" : "Complete route"}
    </button>
  );
}

export function CompleteRouteButton({
  routeId,
  disabled = false,
}: CompleteRouteButtonProps) {
  const action = completeRouteAction.bind(null, routeId);
  return (
    <form action={action} className="mt-4">
      <SubmitButton forceDisabled={disabled} />
    </form>
  );
}
