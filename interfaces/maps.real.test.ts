import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MapsService } from "./maps";

const STUB_TOKEN = "pk.test-token-abc123";

interface ErrorSpy {
  mock: { calls: unknown[][] };
  mockRestore(): void;
  (...args: unknown[]): void;
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, init: { status?: number } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * Collect every argument passed to `errorSpy`, flattened into strings, so
 * we can assert the token does not appear anywhere — including defensive
 * sweeps against non-string args.
 */
function flattenErrorArgs(errorSpy: ErrorSpy): string[] {
  const out: string[] = [];
  for (const call of errorSpy.mock.calls) {
    for (const arg of call) {
      if (typeof arg === "string") {
        out.push(arg);
      } else if (arg instanceof Error) {
        out.push(arg.message);
      } else {
        try {
          out.push(JSON.stringify(arg));
        } catch {
          out.push(String(arg));
        }
      }
    }
  }
  return out;
}

describe("createRealMapsService() — hermetic coverage against mocked global.fetch", () => {
  let service: MapsService;
  let errorSpy: ErrorSpy;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", STUB_TOKEN);
    vi.resetModules();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {}) as unknown as ErrorSpy;
    const mod = await import("./maps.real");
    service = mod.createRealMapsService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  describe("geocode", () => {
    it("returns { lat, lng } on happy path and uses the correct URL", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ features: [{ center: [-74.12, 40.34] }] }),
      );
      const result = await service.geocode("123 Main St");
      expect(result).toEqual({ lat: 40.34, lng: -74.12 });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const urlArg = fetchSpy.mock.calls[0][0] as URL;
      expect(urlArg).toBeInstanceOf(URL);
      expect(urlArg.host).toBe("api.mapbox.com");
      expect(urlArg.pathname.startsWith("/geocoding/v5/mapbox.places/")).toBe(
        true,
      );
      expect(urlArg.searchParams.get("access_token")).toBe(STUB_TOKEN);
      expect(urlArg.searchParams.get("limit")).toBe("1");
      expect(urlArg.searchParams.get("country")).toBe("us");
      expect(urlArg.searchParams.get("types")).toBe("address,place");
    });

    it("throws when Mapbox returns zero features; no token in error", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [] }));
      await expect(service.geocode("nowhere")).rejects.toThrow(
        /no results for/,
      );
      try {
        await service.geocode("nowhere");
      } catch (err) {
        expect((err as Error).message).not.toContain(STUB_TOKEN);
      }
      fetchSpy.mockResolvedValueOnce(jsonResponse({ features: [] }));
    });

    it("throws generic error on non-2xx; no token in any console.error arg", async () => {
      fetchSpy.mockResolvedValueOnce(
        textResponse(
          `Upstream error: api.mapbox.com/...?access_token=${STUB_TOKEN} failed`,
          { status: 500 },
        ),
      );
      await expect(service.geocode("x")).rejects.toThrow(
        /Mapbox returned 500/,
      );
      const flat = flattenErrorArgs(errorSpy);
      for (const s of flat) {
        expect(s).not.toContain(STUB_TOKEN);
      }
      // Defensive: the scrub-pass replaces the `access_token=` query tail.
      for (const s of flat) {
        expect(s).not.toMatch(/access_token=pk\./);
      }
    });

    it("URL-encodes address with spaces and special chars", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ features: [{ center: [-74, 40] }] }),
      );
      await service.geocode("123 Main St, Apt #4 & 5");
      const urlArg = fetchSpy.mock.calls[0][0] as URL;
      const full = urlArg.toString();
      // Percent-encoded characters must be present in the path.
      expect(urlArg.pathname).toContain("%20"); // space
      expect(urlArg.pathname).toContain("%23"); // #
      expect(urlArg.pathname).toContain("%26"); // &
      // And the literal raw chars must NOT split the path.
      expect(urlArg.pathname).not.toContain(" ");
      expect(urlArg.pathname).not.toContain("#");
      // Only one `access_token` in the query (no adversarial injection).
      const allTokens = urlArg.searchParams.getAll("access_token");
      expect(allTokens).toEqual([STUB_TOKEN]);
      // Sanity: path only appears once in the full URL.
      expect(full.indexOf("/geocoding/v5/mapbox.places/")).toBeGreaterThan(0);
    });

    it("throws NotConfiguredError when NEXT_PUBLIC_MAPBOX_TOKEN is unset; no fetch called", async () => {
      vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
      vi.resetModules();
      const mod = await import("./maps.real");
      const deferredService = mod.createRealMapsService();
      try {
        await deferredService.geocode("x");
        throw new Error("expected geocode to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).name).toBe("NotConfiguredError");
        expect((err as Error & { envVar?: string }).envVar).toBe(
          "NEXT_PUBLIC_MAPBOX_TOKEN",
        );
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("routeFor", () => {
    it("returns distance, duration, polyline on happy path", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          routes: [
            { distance: 12345.6, duration: 678.9, geometry: "abcXYZ" },
          ],
        }),
      );
      const result = await service.routeFor({
        stops: [
          { lat: 40, lng: -74 },
          { lat: 40.1, lng: -74.1 },
          { lat: 40.2, lng: -74.2 },
        ],
      });
      expect(result).toEqual({
        distanceMeters: 12345.6,
        durationSeconds: 678.9,
        polyline: "abcXYZ",
      });
      const urlArg = fetchSpy.mock.calls[0][0] as URL;
      // Mapbox order is `lng,lat` (not `lat,lng`).
      expect(urlArg.pathname).toContain("-74,40;-74.1,40.1;-74.2,40.2");
      expect(urlArg.searchParams.get("geometries")).toBe("polyline");
      expect(urlArg.searchParams.get("overview")).toBe("full");
    });

    it("throws when Mapbox returns zero routes; no token in message", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ routes: [] }));
      try {
        await service.routeFor({
          stops: [
            { lat: 40, lng: -74 },
            { lat: 41, lng: -75 },
          ],
        });
        throw new Error("expected routeFor to throw");
      } catch (err) {
        expect((err as Error).message).toMatch(/no routes/);
        expect((err as Error).message).not.toContain(STUB_TOKEN);
      }
    });

    it("throws when called with fewer than 2 stops; fetch not called", async () => {
      await expect(
        service.routeFor({ stops: [{ lat: 40, lng: -74 }] }),
      ).rejects.toThrow(/at least 2 stops/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws generic error on network failure; token scrubbed from rethrow", async () => {
      fetchSpy.mockRejectedValueOnce(
        new Error(
          `ENETUNREACH api.mapbox.com?access_token=${STUB_TOKEN}`,
        ),
      );
      try {
        await service.routeFor({
          stops: [
            { lat: 40, lng: -74 },
            { lat: 41, lng: -75 },
          ],
        });
        throw new Error("expected routeFor to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).not.toContain(STUB_TOKEN);
      }
    });

    it("throws on non-2xx; does not leak token to console.error", async () => {
      fetchSpy.mockResolvedValueOnce(
        textResponse(
          `error body echoing access_token=${STUB_TOKEN}`,
          { status: 500 },
        ),
      );
      await expect(
        service.routeFor({
          stops: [
            { lat: 40, lng: -74 },
            { lat: 41, lng: -75 },
          ],
        }),
      ).rejects.toThrow(/Mapbox returned 500/);
      const flat = flattenErrorArgs(errorSpy);
      for (const s of flat) {
        expect(s).not.toContain(STUB_TOKEN);
      }
    });

    it("throws on malformed route response (missing geometry)", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ routes: [{ distance: 100, duration: 50 }] }),
      );
      await expect(
        service.routeFor({
          stops: [
            { lat: 40, lng: -74 },
            { lat: 41, lng: -75 },
          ],
        }),
      ).rejects.toThrow(/malformed route response/);
    });
  });

  describe("etaFor", () => {
    it("returns durationSeconds from routes[0]; uses overview=false", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ routes: [{ duration: 900 }] }),
      );
      const result = await service.etaFor({
        from: { lat: 40, lng: -74 },
        to: { lat: 41, lng: -75 },
      });
      expect(result).toEqual({ durationSeconds: 900 });
      const urlArg = fetchSpy.mock.calls[0][0] as URL;
      expect(urlArg.searchParams.get("overview")).toBe("false");
      expect(urlArg.pathname).toContain("-74,40;-75,41");
    });

    it("throws when routes is empty", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ routes: [] }));
      await expect(
        service.etaFor({
          from: { lat: 40, lng: -74 },
          to: { lat: 41, lng: -75 },
        }),
      ).rejects.toThrow(/no route found/);
    });

    it("throws on non-2xx; no token in console.error args", async () => {
      fetchSpy.mockResolvedValueOnce(
        textResponse(`upstream error w/ access_token=${STUB_TOKEN}`, {
          status: 502,
        }),
      );
      await expect(
        service.etaFor({
          from: { lat: 40, lng: -74 },
          to: { lat: 41, lng: -75 },
        }),
      ).rejects.toThrow(/Mapbox returned 502/);
      const flat = flattenErrorArgs(errorSpy);
      for (const s of flat) {
        expect(s).not.toContain(STUB_TOKEN);
      }
    });
  });

  describe("cross-cutting invariants", () => {
    it("aborts requests after 10 seconds with a generic 'timed out' error", async () => {
      vi.useFakeTimers();
      // Simulate a never-resolving fetch that rejects with AbortError when
      // the signal fires.
      fetchSpy.mockImplementationOnce((_url: URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const abortErr = new Error("aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          }
        });
      });

      const promise = service.geocode("slow address");
      // Attach a catch handler so the rejection is observed synchronously
      // after we advance timers (prevents unhandled rejection warnings).
      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    });

    it("never leaks access_token across any endpoint (500 sweep)", async () => {
      // geocode 500
      fetchSpy.mockResolvedValueOnce(
        textResponse(
          `echo access_token=${STUB_TOKEN}`,
          { status: 500 },
        ),
      );
      await expect(service.geocode("a")).rejects.toThrow();

      // routeFor 500
      fetchSpy.mockResolvedValueOnce(
        textResponse(
          `echo access_token=${STUB_TOKEN}`,
          { status: 500 },
        ),
      );
      await expect(
        service.routeFor({
          stops: [
            { lat: 40, lng: -74 },
            { lat: 41, lng: -75 },
          ],
        }),
      ).rejects.toThrow();

      // etaFor 500
      fetchSpy.mockResolvedValueOnce(
        textResponse(
          `echo access_token=${STUB_TOKEN}`,
          { status: 500 },
        ),
      );
      await expect(
        service.etaFor({
          from: { lat: 40, lng: -74 },
          to: { lat: 41, lng: -75 },
        }),
      ).rejects.toThrow();

      const flat = flattenErrorArgs(errorSpy);
      for (const s of flat) {
        expect(s).not.toMatch(/pk\.test-token-abc123/);
      }
    });

    it("URL construction never puts raw user input in the path (query-injection attempt)", async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ features: [{ center: [-74, 40] }] }),
      );
      await service.geocode("?access_token=evil&x=");
      const urlArg = fetchSpy.mock.calls[0][0] as URL;
      // Exactly one `access_token` query value, and it's the stub token.
      const allTokens = urlArg.searchParams.getAll("access_token");
      expect(allTokens).toEqual([STUB_TOKEN]);
      // No `x` key from the adversarial input.
      expect(urlArg.searchParams.get("x")).toBeNull();
      // Path segment contains the percent-encoded form.
      expect(urlArg.pathname).toContain("%3F"); // ?
      expect(urlArg.pathname).toContain("%3D"); // =
      expect(urlArg.pathname).toContain("%26"); // &
    });
  });
});
