"use client";

import { addStopToRouteAction } from "../../actions";

interface AddStopFormProps {
  routeId: string;
  pickupRequestId: string;
}

export function AddStopForm({ routeId, pickupRequestId }: AddStopFormProps) {
  const boundAction = addStopToRouteAction.bind(null, routeId);

  return (
    <form action={boundAction}>
      <input type="hidden" name="pickupRequestId" value={pickupRequestId} />
      <button
        type="submit"
        className="text-xs font-medium text-blue-600 hover:underline"
      >
        Add to this route
      </button>
    </form>
  );
}
