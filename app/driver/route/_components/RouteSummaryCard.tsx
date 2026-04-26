interface RouteSummaryCardProps {
  remainingStops: number;
  driveMinutes: number;
  pickupMinutes: number;
  finishLabel: string;
  fromGoogle: boolean;
  fullRouteUrl?: string | null;
}

export function RouteSummaryCard({
  remainingStops,
  driveMinutes,
  pickupMinutes,
  finishLabel,
  fromGoogle,
  fullRouteUrl,
}: RouteSummaryCardProps) {
  if (remainingStops === 0) return null;
  const stopWord = remainingStops === 1 ? "stop" : "stops";
  return (
    <section className="app-card mb-4 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
        Today
      </p>
      <p className="mt-1 text-base font-semibold text-[var(--brand-950)]">
        {remainingStops} {stopWord} · ~{driveMinutes}m drive + {pickupMinutes}m
        pickup
      </p>
      <p className="mt-1 text-sm text-gray-600">
        Finish by <span className="font-bold">{finishLabel}</span>
        {fromGoogle ? (
          <span className="ml-2 text-xs text-gray-500">(with traffic)</span>
        ) : (
          <span className="ml-2 text-xs text-gray-500">(estimate)</span>
        )}
      </p>
      {fullRouteUrl ? (
        <a
          href={fullRouteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary mt-3 w-full sm:w-auto"
        >
          Open full route in Google Maps →
        </a>
      ) : null}
    </section>
  );
}
