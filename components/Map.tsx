"use client";

/**
 * Shared Mapbox map component used across driver, dispatcher, and admin
 * pages. All five map surfaces (driver route, dispatcher single route,
 * dispatcher live tracking, admin office list, admin single office) feed
 * this one component different `pins` and flags.
 *
 * Fallback paths:
 *   - No `NEXT_PUBLIC_MAPBOX_TOKEN` → render a "Map unavailable" note
 *     rather than throwing.
 *   - Zero pins → empty map centered on NYC (spec default).
 *   - Pins with non-finite lat/lng → silently filtered.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export interface MapPin {
  lat: number;
  lng: number;
  /** Short label rendered on the pin (e.g. "1", "2"). */
  label?: string;
  /** CSS color for the pin marker. Defaults to `#2563eb` (blue-600). */
  color?: string;
  /** Plain-text popup shown on pin click. Rendered as text, not HTML. */
  popup?: string;
  /** Stable id passed to `onPinClick`. */
  id?: string;
}

export interface MapProps {
  pins: MapPin[];
  /** Draw a polyline connecting `pins` in array order. */
  showRoute?: boolean;
  /** If set, triggers `router.refresh()` on this interval (for live views). */
  autoRefreshMs?: number;
  /** CSS height. Defaults to `400px`. */
  height?: string;
  /** Fires with `pin.id` when a pin is clicked. */
  onPinClick?: (id: string) => void;
  className?: string;
}

const NYC_CENTER: [number, number] = [-74.006, 40.7128];
const DEFAULT_ZOOM = 10;
const SINGLE_PIN_ZOOM = 13;
const DEFAULT_COLOR = "#2563eb";

function isFinitePin(p: MapPin): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

export function MapView({
  pins,
  showRoute = false,
  autoRefreshMs,
  height = "400px",
  onPinClick,
  className,
}: MapProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  const validPins = useMemo(() => pins.filter(isFinitePin), [pins]);

  // Initialize the map once.
  useEffect(() => {
    if (!token) return;
    if (!containerRef.current) return;
    if (mapRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: NYC_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.on("load", () => setReady(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      setReady(false);
    };
  }, [token]);

  // Sync markers + route line + viewport whenever pins change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // Clear previous markers.
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const p of validPins) {
      const el = document.createElement("div");
      el.style.width = "28px";
      el.style.height = "28px";
      el.style.borderRadius = "50%";
      el.style.backgroundColor = p.color ?? DEFAULT_COLOR;
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.3)";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.color = "white";
      el.style.fontSize = "12px";
      el.style.fontWeight = "600";
      el.style.cursor = onPinClick ? "pointer" : "default";
      if (p.label) el.textContent = p.label;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .addTo(map);

      if (p.popup) {
        marker.setPopup(
          new mapboxgl.Popup({ offset: 18, closeButton: true }).setText(p.popup),
        );
      }

      if (onPinClick && p.id !== undefined) {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onPinClick(p.id as string);
        });
      }

      markersRef.current.push(marker);
    }

    // Route line.
    const ROUTE_SOURCE_ID = "ld-route-line";
    const ROUTE_LAYER_ID = "ld-route-line-layer";
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);

    if (showRoute && validPins.length >= 2) {
      map.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: validPins.map((p) => [p.lng, p.lat]),
          },
        },
      });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#2563eb",
          "line-width": 3,
          "line-opacity": 0.7,
        },
      });
    }

    // Viewport: auto-fit to pins.
    if (validPins.length === 0) {
      map.easeTo({ center: NYC_CENTER, zoom: DEFAULT_ZOOM, duration: 0 });
    } else if (validPins.length === 1) {
      map.easeTo({
        center: [validPins[0].lng, validPins[0].lat],
        zoom: SINGLE_PIN_ZOOM,
        duration: 0,
      });
    } else {
      const bounds = new mapboxgl.LngLatBounds();
      for (const p of validPins) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: 50, duration: 0, maxZoom: 14 });
    }
  }, [validPins, showRoute, ready, onPinClick]);

  // Optional auto-refresh for live views.
  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs <= 0) return;
    const id = setInterval(() => {
      router.refresh();
    }, autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, router]);

  if (!token) {
    return (
      <div
        data-testid="map-unavailable"
        className={`flex items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 ${className ?? ""}`}
        style={{ height }}
      >
        Map unavailable — NEXT_PUBLIC_MAPBOX_TOKEN not configured
      </div>
    );
  }

  return (
    <div
      data-testid="map-container"
      ref={containerRef}
      className={`overflow-hidden rounded border border-gray-200 ${className ?? ""}`}
      style={{ height, width: "100%" }}
    />
  );
}
