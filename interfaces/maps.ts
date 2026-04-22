import { NotConfiguredError } from "@/lib/errors";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteFromStopsParams {
  stops: LatLng[];
}

export interface RouteFromStopsResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
}

export interface EtaParams {
  from: LatLng;
  to: LatLng;
}

export interface EtaResult {
  durationSeconds: number;
}

export interface MapsService {
  geocode(address: string): Promise<LatLng>;
  routeFor(params: RouteFromStopsParams): Promise<RouteFromStopsResult>;
  etaFor(params: EtaParams): Promise<EtaResult>;
}

function notConfigured(): never {
  throw new NotConfiguredError({
    service: "maps (Mapbox)",
    envVar: "NEXT_PUBLIC_MAPBOX_TOKEN",
  });
}

export function createRealMapsService(): MapsService {
  return {
    async geocode() {
      notConfigured();
    },
    async routeFor() {
      notConfigured();
    },
    async etaFor() {
      notConfigured();
    },
  };
}
