"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import type { OfficeAddress, PickupUrgency } from "@/lib/types";
import { googleMapsSearchUrl } from "@/lib/office-links";
import { arriveAtStopAction, pickupStopAction } from "../actions";

export type StopCardStatus = "pending" | "arrived" | "picked_up";

interface StopCardProps {
  stopId: string;
  position: number;
  officeName: string;
  address?: OfficeAddress;
  urgency: PickupUrgency;
  sampleCount?: number;
  specialInstructions?: string;
  status: StopCardStatus;
  isCurrent: boolean;
  canCheckIn: boolean;
}

const URGENCY_STYLE: Record<PickupUrgency, string> = {
  routine: "bg-gray-100 text-gray-700",
  urgent: "bg-amber-100 text-amber-800",
  stat: "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<StopCardStatus, string> = {
  pending: "Pending",
  arrived: "Arrived",
  picked_up: "Picked up",
};

function PrimaryButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
    >
      {pending ? "Submitting…" : label}
    </button>
  );
}

export function StopCard({
  stopId,
  position,
  officeName,
  address,
  urgency,
  sampleCount,
  specialInstructions,
  status,
  isCurrent,
  canCheckIn,
}: StopCardProps) {
  const containerCls = [
    "rounded-2xl border p-4 bg-white",
    isCurrent ? "ring-2 ring-blue-500 border-blue-200" : "border-gray-200",
    status === "picked_up" ? "opacity-60" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const boundArrive = arriveAtStopAction.bind(null, stopId);
  const boundPickup = pickupStopAction.bind(null, stopId);

  return (
    <article className={containerCls}>
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-gray-900 px-2 text-xs font-bold text-white">
          #{position}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${URGENCY_STYLE[urgency]}`}
        >
          {urgency}
        </span>
        <span className="ml-auto rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
          {STATUS_LABEL[status]}
        </span>
      </div>

      <h3 className="text-xl font-semibold text-gray-900">{officeName}</h3>
      {address ? (
        <address className="mt-1 text-sm not-italic text-gray-600">
          {address.street}
          <br />
          {address.city}, {address.state} {address.zip}
        </address>
      ) : null}

      {typeof sampleCount === "number" ? (
        <p className="mt-2 text-sm text-gray-700">Samples: {sampleCount}</p>
      ) : null}

      {specialInstructions && specialInstructions.length > 0 ? (
        <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
          {specialInstructions}
        </p>
      ) : null}

      {address ? (
        <a
          href={googleMapsSearchUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline"
        >
          Open in Maps
        </a>
      ) : null}

      {canCheckIn && status === "pending" ? (
        <form action={boundArrive} className="mt-4">
          <PrimaryButton label="I've arrived" />
        </form>
      ) : null}
      {canCheckIn && status === "arrived" ? (
        <form action={boundPickup} className="mt-4">
          <PrimaryButton label="Samples picked up" />
        </form>
      ) : null}
      {status === "picked_up" ? (
        <p className="mt-4 text-center text-sm font-medium text-gray-500">
          Completed
        </p>
      ) : null}

      <div className="mt-3 text-right">
        <Link
          href={`/driver/route/${stopId}`}
          className="text-xs text-blue-600 hover:underline"
        >
          Details →
        </Link>
      </div>
    </article>
  );
}
