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
  routine: "badge badge-neutral",
  urgent: "badge badge-warning",
  stat: "badge badge-danger",
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
      className="mobile-action disabled:opacity-60"
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
    "app-card p-4",
    isCurrent ? "ring-4 ring-teal-100 border-[var(--brand-500)]" : "",
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
          className={URGENCY_STYLE[urgency]}
        >
          {urgency}
        </span>
        <span className="badge badge-info ml-auto">
          {STATUS_LABEL[status]}
        </span>
      </div>

      <h3 className="text-xl font-black text-[var(--brand-950)]">{officeName}</h3>
      {address ? (
        <address className="mt-1 text-sm leading-6 not-italic text-gray-600">
          {address.street}
          <br />
          {address.city}, {address.state} {address.zip}
        </address>
      ) : null}

      {typeof sampleCount === "number" ? (
        <p className="mt-2 text-sm font-semibold text-gray-700">
          Samples: {sampleCount}
        </p>
      ) : null}

      {specialInstructions && specialInstructions.length > 0 ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          {specialInstructions}
        </p>
      ) : null}

      {address ? (
        <a
          href={googleMapsSearchUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary mt-3 min-h-10"
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
          className="btn-link text-xs"
        >
          Details →
        </Link>
      </div>
    </article>
  );
}
