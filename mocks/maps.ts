import type {
  EtaParams,
  EtaResult,
  LatLng,
  MapsService,
  RouteFromStopsParams,
  RouteFromStopsResult,
} from "@/interfaces/maps";

// Deterministic geocode: base point + per-char-code offset.
// base = { lat: 40.0, lng: -74.0 }
// lat offset = (sumCharCodes % 1000) / 10000  -> 0..0.0999
// lng offset = (sumCharCodes % 2000) / 10000  -> 0..0.1999
function sumCharCodes(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i += 1) {
    sum += s.charCodeAt(i);
  }
  return sum;
}

// Haversine great-circle distance in kilometers.
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export const mapsMock: MapsService = {
  async geocode(address: string): Promise<LatLng> {
    const sum = sumCharCodes(address);
    return {
      lat: 40.0 + (sum % 1000) / 10000,
      lng: -74.0 + (sum % 2000) / 10000,
    };
  },

  async routeFor(params: RouteFromStopsParams): Promise<RouteFromStopsResult> {
    const n = params.stops.length;
    return {
      distanceMeters: n * 1000,
      durationSeconds: n * 120,
      polyline: `mock-polyline:${params.stops.map((s) => `${s.lat},${s.lng}`).join("|")}`,
    };
  },

  async etaFor(params: EtaParams): Promise<EtaResult> {
    const km = haversineKm(params.from, params.to);
    return { durationSeconds: Math.round(km * 60) };
  },
};

export function resetMapsMock(): void {
  // Maps mock is stateless. Exported for uniformity.
}
