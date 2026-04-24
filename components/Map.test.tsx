/**
 * Tests for the shared Map component.
 *
 * `mapbox-gl` is mocked because jsdom has no WebGL — the real library
 * throws at construction time. The mock records every call the component
 * makes (marker creation, source/layer add, fitBounds) so we can assert
 * on the contract without exercising actual GL rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- mapbox-gl mock ---------------------------------------------------------

type MarkerCallArgs = unknown[];

const markerInstances: Array<{
  setLngLat: ReturnType<typeof vi.fn>;
  addTo: ReturnType<typeof vi.fn>;
  setPopup: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  element: HTMLElement;
}> = [];

const mapInstance = {
  addControl: vi.fn(),
  on: vi.fn((event: string, cb: () => void) => {
    if (event === "load") cb();
  }),
  remove: vi.fn(),
  getLayer: vi.fn(() => false),
  removeLayer: vi.fn(),
  getSource: vi.fn(() => false),
  removeSource: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  easeTo: vi.fn(),
  fitBounds: vi.fn(),
};

const boundsExtend = vi.fn();
const boundsInstance = { extend: boundsExtend };

vi.mock("mapbox-gl", () => {
  const MapClass = vi.fn().mockImplementation(() => mapInstance);
  const MarkerClass = vi
    .fn()
    .mockImplementation((opts?: { element?: HTMLElement }) => {
      const inst = {
        setLngLat: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
        setPopup: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        element: opts?.element ?? document.createElement("div"),
      };
      markerInstances.push(inst);
      return inst;
    });
  const PopupClass = vi.fn().mockImplementation(() => ({
    setText: vi.fn().mockReturnThis(),
  }));
  const NavigationControlClass = vi.fn();
  const LngLatBoundsClass = vi.fn().mockImplementation(() => boundsInstance);

  return {
    default: {
      Map: MapClass,
      Marker: MarkerClass,
      Popup: PopupClass,
      NavigationControl: NavigationControlClass,
      LngLatBounds: LngLatBoundsClass,
      accessToken: "",
    },
  };
});

// Stub next/navigation router — jsdom has no Next router context.
const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

// Empty CSS import stub (mapbox-gl.css is irrelevant in tests).
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

// Set token before component module evaluates env access.
process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.test-token";

// Import AFTER mocks are registered.
const { MapView } = await import("./Map");
const mapboxgl = (await import("mapbox-gl")).default as unknown as {
  Map: ReturnType<typeof vi.fn>;
  Marker: ReturnType<typeof vi.fn>;
  LngLatBounds: ReturnType<typeof vi.fn>;
};

function clearMockCalls() {
  markerInstances.length = 0;
  boundsExtend.mockClear();
  mapboxgl.Map.mockClear();
  mapboxgl.Marker.mockClear();
  mapboxgl.LngLatBounds.mockClear();
  mapInstance.addControl.mockClear();
  mapInstance.fitBounds.mockClear();
  mapInstance.easeTo.mockClear();
  mapInstance.addSource.mockClear();
  mapInstance.addLayer.mockClear();
  routerRefreshMock.mockClear();
}

describe("Map", () => {
  beforeEach(() => {
    clearMockCalls();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders an empty-state map when pins is empty", () => {
    render(<MapView pins={[]} />);
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    // Constructed the map, but created no markers.
    expect(mapboxgl.Map).toHaveBeenCalledTimes(1);
    expect(markerInstances).toHaveLength(0);
    // Empty case uses easeTo to NYC, not fitBounds.
    expect(mapInstance.fitBounds).not.toHaveBeenCalled();
    expect(mapInstance.easeTo).toHaveBeenCalled();
  });

  it("renders a single pin and centers on it (no fitBounds)", () => {
    render(
      <MapView
        pins={[{ lat: 40.7128, lng: -74.006, label: "1", popup: "Only stop" }]}
      />,
    );
    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0].setLngLat).toHaveBeenCalledWith([-74.006, 40.7128]);
    expect(markerInstances[0].setPopup).toHaveBeenCalled();
    expect(mapInstance.fitBounds).not.toHaveBeenCalled();
    expect(mapInstance.easeTo).toHaveBeenCalled();
  });

  it("renders four pins and auto-fits bounds", () => {
    const pins = [
      { lat: 40.7, lng: -74.0, label: "1" },
      { lat: 40.75, lng: -73.98, label: "2" },
      { lat: 40.73, lng: -74.01, label: "3" },
      { lat: 40.71, lng: -73.99, label: "4" },
    ];
    render(<MapView pins={pins} />);
    expect(markerInstances).toHaveLength(4);
    expect(mapboxgl.LngLatBounds).toHaveBeenCalledTimes(1);
    expect(boundsExtend).toHaveBeenCalledTimes(4);
    expect(mapInstance.fitBounds).toHaveBeenCalled();
  });

  it("draws a polyline when showRoute=true and pins.length >= 2", () => {
    render(
      <MapView
        showRoute
        pins={[
          { lat: 40.7, lng: -74.0 },
          { lat: 40.75, lng: -73.98 },
        ]}
      />,
    );
    expect(mapInstance.addSource).toHaveBeenCalledTimes(1);
    expect(mapInstance.addLayer).toHaveBeenCalledTimes(1);
    const sourceCall = mapInstance.addSource.mock.calls[0];
    const sourceConfig = sourceCall[1] as {
      data: { geometry: { coordinates: number[][] } };
    };
    expect(sourceConfig.data.geometry.coordinates).toEqual([
      [-74.0, 40.7],
      [-73.98, 40.75],
    ]);
  });

  it("does NOT draw a polyline when showRoute=true but only one pin", () => {
    render(<MapView showRoute pins={[{ lat: 40.7, lng: -74.0 }]} />);
    expect(mapInstance.addSource).not.toHaveBeenCalled();
    expect(mapInstance.addLayer).not.toHaveBeenCalled();
  });

  it("filters out pins with non-finite coordinates", () => {
    render(
      <MapView
        pins={[
          { lat: 40.7, lng: -74.0 },
          { lat: Number.NaN, lng: -74.0 },
          { lat: 40.7, lng: Number.POSITIVE_INFINITY },
          { lat: 91, lng: -74.0 },
          { lat: 40.7, lng: -181 },
        ]}
      />,
    );
    expect(markerInstances).toHaveLength(1);
  });

  it("calls onPinClick with the pin id when a pin is clicked", async () => {
    const onPinClick = vi.fn();
    const user = userEvent.setup();
    render(
      <MapView
        onPinClick={onPinClick}
        pins={[
          { id: "pin-a", lat: 40.7, lng: -74.0 },
          { id: "pin-b", lat: 40.75, lng: -73.98 },
        ]}
      />,
    );
    await user.click(markerInstances[1].element);
    expect(onPinClick).toHaveBeenCalledWith("pin-b");
  });

  it("renders the fallback when NEXT_PUBLIC_MAPBOX_TOKEN is unset", async () => {
    const original = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    // Re-import Map so it picks up the now-unset env at module scope.
    vi.resetModules();
    const { MapView: MapFresh } = await import("./Map");
    render(<MapFresh pins={[{ lat: 40.7, lng: -74.0 }]} />);
    expect(screen.getByTestId("map-unavailable")).toBeInTheDocument();
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = original;
  });

  it("sets up an interval for auto-refresh and clears it on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<MapView pins={[]} autoRefreshMs={30_000} />);
    expect(routerRefreshMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(routerRefreshMock).toHaveBeenCalledTimes(2);
    unmount();
    vi.advanceTimersByTime(30_000);
    expect(routerRefreshMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
