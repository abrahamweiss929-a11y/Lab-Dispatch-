"use client";

/**
 * Foreground-only GPS sampler. Mounted on `/driver/route` while the route
 * is active. No component-level tests: the load-bearing logic is in the
 * server action (`recordLocationAction`), which is tested exhaustively in
 * `app/driver/actions.test.ts`. Here we just:
 *
 *   1. `navigator.geolocation.watchPosition` to latch the latest coord.
 *   2. Fire the server action on a fixed `intervalMs` tick (default 60s).
 *   3. Render a tiny "Location unavailable" note if the API is missing or
 *      permission was denied.
 *
 * The 60s interval is hardcoded per SPEC ("every 1–2 minutes"); see plan
 * open question 7 for the rationale. When the browser tab is backgrounded
 * most mobile browsers suspend both `watchPosition` and `setInterval` —
 * that's accepted for v1 (no background location; see plan open question
 * 6).
 *
 * Geolocation requires a secure context (HTTPS). On HTTP dev previews
 * the API denies immediately and we fall through to the "unavailable"
 * note — expected behavior, documented in the plan.
 */

import { useEffect, useRef, useState } from "react";
import { recordLocationAction } from "@/app/driver/actions";

interface GpsSamplerProps {
  routeId: string;
  enabled: boolean;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 60_000;

interface LatchedPosition {
  lat: number;
  lng: number;
  ts: number;
}

export function GpsSampler({
  enabled,
  intervalMs = DEFAULT_INTERVAL_MS,
}: GpsSamplerProps) {
  const [unavailable, setUnavailable] = useState(false);
  const latest = useRef<LatchedPosition | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setUnavailable(true);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        latest.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: Date.now(),
        };
      },
      () => {
        setUnavailable(true);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 },
    );

    const staleAfterMs = intervalMs * 3;
    const tick = async () => {
      const snapshot = latest.current;
      if (!snapshot) return;
      if (Date.now() - snapshot.ts > staleAfterMs) return;
      try {
        await recordLocationAction({ lat: snapshot.lat, lng: snapshot.lng });
      } catch {
        // Swallow — the next tick will try again. Never interrupt the UI.
      }
    };
    const intervalId = setInterval(tick, intervalMs);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(intervalId);
    };
  }, [enabled, intervalMs]);

  if (!enabled) return null;
  if (unavailable) {
    return (
      <p className="py-2 text-center text-xs text-gray-400">
        Location unavailable
      </p>
    );
  }
  return null;
}
