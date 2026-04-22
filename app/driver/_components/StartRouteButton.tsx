"use client";

import { useFormStatus } from "react-dom";
import { startRouteAction } from "../actions";

interface StartRouteButtonProps {
  routeId: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
    >
      {pending ? "Starting…" : "Start route"}
    </button>
  );
}

export function StartRouteButton({ routeId }: StartRouteButtonProps) {
  const action = startRouteAction.bind(null, routeId);
  return (
    <form action={action} className="mt-4">
      <SubmitButton />
    </form>
  );
}
