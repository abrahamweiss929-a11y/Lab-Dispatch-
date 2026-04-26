"use client";

import type { FormEvent } from "react";
import {
  moveStopDownAction,
  moveStopUpAction,
  removeStopAction,
} from "../../actions";

interface StopRowProps {
  routeId: string;
  stopId: string;
  position: number;
  officeName: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function StopRow({
  routeId,
  stopId,
  position,
  officeName,
  canMoveUp,
  canMoveDown,
}: StopRowProps) {
  const boundUp = moveStopUpAction.bind(null, routeId, stopId);
  const boundDown = moveStopDownAction.bind(null, routeId, stopId);
  const boundRemove = removeStopAction.bind(null, routeId, stopId);

  function confirmRemove(event: FormEvent<HTMLFormElement>): void {
    if (!window.confirm("Remove this stop from the route?")) {
      event.preventDefault();
    }
  }

  return (
    <tr>
      <td className="px-4 py-2 font-medium">{position}</td>
      <td className="px-4 py-2">{officeName}</td>
      <td className="flex gap-2 px-4 py-2">
        <form action={boundUp}>
          <button
            type="submit"
            disabled={!canMoveUp}
            className="btn btn-secondary min-h-8 px-2 py-1 text-xs disabled:opacity-40"
          >
            Up
          </button>
        </form>
        <form action={boundDown}>
          <button
            type="submit"
            disabled={!canMoveDown}
            className="btn btn-secondary min-h-8 px-2 py-1 text-xs disabled:opacity-40"
          >
            Down
          </button>
        </form>
        <form action={boundRemove} onSubmit={confirmRemove}>
          <button type="submit" className="btn-danger text-xs hover:underline">
            Remove
          </button>
        </form>
      </td>
    </tr>
  );
}
