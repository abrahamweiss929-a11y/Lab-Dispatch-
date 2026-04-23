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

// The real adapter lives in a `"server-only"` module so webpack errors
// if anyone accidentally pulls it into a Client Component. Callers
// continue to import the interface + helper types from this file.
export { createRealMapsService } from "./maps.real";
