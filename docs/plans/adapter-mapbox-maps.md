# Plan: Real Mapbox Maps Adapter

**Slug:** adapter-mapbox-maps
**SPEC reference:** "Mapbox (maps and routing)" (SPEC.md line 55); consumed by `lib/request-to-stop.ts` (assignment ETA) and `lib/heads-up.ts` (10-minute GPS heads-up); powers `MapsService.{geocode, routeFor, etaFor}` declared in `interfaces/maps.ts`.
**Status:** draft

## Goal

Replace the `notConfigured()`-only stub in `interfaces/maps.ts::createRealMapsService` with a working Mapbox-backed implementation built on the Mapbox REST API and the platform `fetch`, so that when `USE_MOCKS=false` and `NEXT_PUBLIC_MAPBOX_TOKEN` is set, `geocode`, `routeFor`, and `etaFor` hit real Mapbox endpoints. Mock behavior (`mocks/maps.ts`) and every existing caller (`convertRequestToStop`, `maybeNotifyOffice`) stay untouched.

## Out of scope

- Real-time traffic adjustments (Directions `driving-traffic` profile / traffic annotations).
- Matrix API / multi-destination optimization (for >~12 stops we'd want `directions-matrix` or the Optimization API — not v1).
- Map rendering on the client (dispatcher-UI map refresh is a separate pass; `NEXT_PUBLIC_MAPBOX_TOKEN` is scoped public-safe so that future work can reuse the same env var).
- Geocoding autocomplete / search-as-you-type (Mapbox `searchbox` / `places` suggestion endpoints).
- Adding `@mapbox/mapbox-sdk` or any other Mapbox SDK dependency. See **Architecture decision: no SDK** below.
- Changes to `mocks/maps.ts` — deterministic sum-of-char-codes geocode + synthetic routing stays as-is for tests and dev.
- Changes to `lib/request-to-stop.ts` or `lib/heads-up.ts` — both consume `MapsService` through `getServices()` and already handle maps errors (best-effort ETA in `convertRequestToStop`, `status: "error"` in `maybeNotifyOffice`). The real adapter satisfies the same interface contract.
- A real integration test that hits `api.mapbox.com` — all tests mock `global.fetch`.

## Architecture decision: no SDK

We do **not** add `@mapbox/mapbox-sdk` (or any Mapbox JS client) for v1. The three methods we need map to exactly three REST endpoints, and `fetch` + `new URL(...)` is ~60 lines of code total. Trade-offs captured so the next person doesn't have to re-derive them:

- **Dependency footprint.** `@mapbox/mapbox-sdk` pulls a runtime + deep client tree; our use is trivially served by `fetch`. Fewer deps = smaller bundle (even server-only), faster `npm install`, less supply-chain risk.
- **Testability.** Mocking `global.fetch` via `vi.spyOn(globalThis, "fetch")` is a single, well-understood seam. Mocking the SDK's service clients means either `vi.mock("@mapbox/mapbox-sdk", ...)` with deep shape matching or hand-rolling service mocks — both more invasive than a fetch spy.
- **API surface stability.** Mapbox REST endpoints are versioned (`/v5/`) and stable; the SDK's ergonomics ("services," builders) are a thicker abstraction than we need.
- **Error handling.** Going through `fetch` gives us direct control over status-code handling, timeouts (`AbortController`), and token scrubbing in error messages. The SDK abstracts some of that away.

If/when Matrix or live traffic lands in v1.x, we revisit — the SDK may pay for itself then. For v1 the answer is "three small URL builders + `fetch`."

## Files to create or modify

- `interfaces/maps.real.ts` — **new**. `import "server-only"` module. Exports `createRealMapsService(): MapsService`. Lazy env read via a `getToken()` helper that throws `NotConfiguredError` on first use when `NEXT_PUBLIC_MAPBOX_TOKEN` is missing. Implements all three methods via Mapbox REST endpoints using `fetch` with a 10-second `AbortController` timeout. Scrubs `access_token` from any error text before logging / throwing.
- `interfaces/maps.ts` — **rewrite** into the same shape as `interfaces/auth.ts` + `interfaces/ai.ts`: keep the interface + param/result type exports, drop the inline stub (`notConfigured` + the three stubbed methods + the inline `createRealMapsService`), and re-export `createRealMapsService` from `./maps.real`.
- `interfaces/maps.real.test.ts` — **new**. Mocks `global.fetch`. Covers geocode happy/empty/network-error, routeFor happy/no-routes/network-error, etaFor happy, missing token, URL encoding of special chars, token-scrubbing on errors, 10-second timeout via fake timers. No real HTTP.

No other file needs to change:
- `interfaces/index.ts` already routes `createRealMapsService` through `./maps` — the re-export keeps that import path working.
- `mocks/maps.ts` uses only `import type { ... } from "@/interfaces/maps"` — still resolves after the rewrite since type exports are preserved.
- `lib/request-to-stop.ts` and `lib/heads-up.ts` consume `maps` via `getServices()` — unaffected.
- `package.json` — **no dep changes**. `fetch` is platform-native in Node 18+ and Next.js.

## Interfaces / contracts

No interface shape change. `MapsService`, `LatLng`, `RouteFromStopsParams`, `RouteFromStopsResult`, `EtaParams`, `EtaResult` stay exactly as they are in `interfaces/maps.ts`:

```ts
geocode(address: string): Promise<LatLng>;
routeFor(params: { stops: LatLng[] }): Promise<{
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
}>;
etaFor(params: { from: LatLng; to: LatLng }): Promise<{
  durationSeconds: number;
}>;
```

Hard invariants the real adapter must uphold:

- **`import "server-only"`.** Webpack must error if anyone pulls this module into a Client Component. `NEXT_PUBLIC_MAPBOX_TOKEN` is public-safe (`pk.*`) and fine to expose on the client, but for v1 we gate all calls through the server to keep one policy and to avoid accidentally leaking the future secret (`sk.*`) token if someone later swaps envs.
- **Never logs or echoes the token.** Not full, not masked, not first/last N chars. All error messages and `console.error` calls run through a `scrubToken(str)` helper that replaces every occurrence of the token with `"[redacted]"`. Defense in depth: URL construction uses `new URL` + `searchParams.set("access_token", token)` so the token is never string-interpolated into paths, and the `scrub` pass runs unconditionally on every error before it surfaces.
- **Lazy `NotConfiguredError`.** Missing `NEXT_PUBLIC_MAPBOX_TOKEN` throws only at method call time (not at `createRealMapsService()`-construction time), matching `interfaces/ai.real.ts`'s `getClient()` pattern. This keeps `getServices()` cheap when `USE_MOCKS=false` but callers never touch maps.
- **10-second fetch timeout** on every outbound HTTP call via `AbortController`. On abort, throw a generic `Error("maps request timed out")` — scrubbed, and without revealing the URL path.
- **Generic thrown errors.** All non-success paths (timeout, non-2xx, network throw, empty results) throw `Error` with a sanitized message like `"maps.geocode: no results for <address>"` or `"maps.routeFor: Mapbox returned 500"`. Nothing that could leak the token or Mapbox-internal structured error payloads.
- **No `GET /.../<user-input>` path interpolation.** For geocode, the `{query}` segment is built via `encodeURIComponent(address)` on a `new URL` base. For Directions, the coord string is built from `LatLng` numbers only (no user-supplied strings ever reach the path). The `URL` class handles the rest of the query parameters.

### Endpoint shapes we depend on

```
GET https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded_query}.json
    ?access_token=...
    &limit=1
    &country=us
    &types=address,place
→ 200 { features: [{ center: [lng, lat], ... }], ... }

GET https://api.mapbox.com/directions/v5/mapbox/driving/{lng,lat;lng,lat;...}
    ?access_token=...
    &geometries=polyline
    &overview=full
→ 200 { routes: [{ distance: meters, duration: seconds, geometry: "encoded_polyline" }], ... }
```

`etaFor` is just `routeFor` with two stops, reading only `routes[0].duration`.

## Implementation steps

1. **Create `interfaces/maps.real.ts`** with the module preamble:
   - `import "server-only";`
   - `import { NotConfiguredError } from "@/lib/errors";`
   - `import type { EtaParams, EtaResult, LatLng, MapsService, RouteFromStopsParams, RouteFromStopsResult } from "./maps";`

2. **Module-level constants** (all `const`, doc-commented):
   - `const GEOCODE_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places";`
   - `const DIRECTIONS_BASE = "https://api.mapbox.com/directions/v5/mapbox/driving";`
   - `const FETCH_TIMEOUT_MS = 10_000;` — doc-comment: "Upper bound on any single Mapbox call. Larger than the ~2s p99 we expect but small enough that a hung route-compute never stalls the dispatcher UI or the driver heads-up flow."
   - `const GEOCODE_COUNTRY = "us";` — v1 is US-only per SPEC.
   - `const GEOCODE_TYPES = "address,place";` — filter out POIs / neighborhoods, focus on deliverable addresses.

3. **Add the `scrubToken` helper** (module-private):
   ```ts
   function scrubToken(s: string, token: string): string {
     if (!token) return s;
     // Replace every literal occurrence of the token with [redacted].
     // Plus defensively strip any `access_token=<anything-non-&>` query
     // param that might show up in SDK/URL-derived error strings.
     return s
       .split(token).join("[redacted]")
       .replace(/access_token=[^&\s"']+/g, "access_token=[redacted]");
   }
   ```

4. **Add `fetchWithTimeout(url: URL, token: string): Promise<Response>`** (module-private):
   - Construct `const controller = new AbortController();`
   - `const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);`
   - `try { return await fetch(url, { signal: controller.signal }); }`
   - `catch (err)`: if `err instanceof Error && err.name === "AbortError"`, throw `new Error("maps request timed out")`; otherwise rethrow a new `Error(scrubToken(String((err as Error).message ?? err), token))`.
   - `finally { clearTimeout(timeout); }`
   - Doc-comment notes the two failure surfaces: abort (timeout) vs network throw (DNS, TLS, connection reset). Both get scrubbed.

5. **Implement `createRealMapsService()`** (mirrors `createRealAiService` lazy pattern):
   ```ts
   export function createRealMapsService(): MapsService {
     function getToken(): string {
       const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
       if (!token) {
         throw new NotConfiguredError({
           service: "maps (Mapbox)",
           envVar: "NEXT_PUBLIC_MAPBOX_TOKEN",
         });
       }
       return token;
     }
     return { geocode: async (...) => ..., routeFor: ..., etaFor: ... };
   }
   ```
   - No caching of the token — it's a cheap `process.env` read and keeping it uncached means hot-reload test patterns work without `vi.resetModules()` for every test.

6. **Implement `geocode(address)`**:
   - `const token = getToken();`
   - `const url = new URL(` + `${GEOCODE_BASE}/${encodeURIComponent(address)}.json` + `);`
   - `url.searchParams.set("access_token", token);`
   - `url.searchParams.set("limit", "1");`
   - `url.searchParams.set("country", GEOCODE_COUNTRY);`
   - `url.searchParams.set("types", GEOCODE_TYPES);`
   - `const resp = await fetchWithTimeout(url, token);`
   - If `!resp.ok`: `console.error("maps.geocode: Mapbox returned", resp.status, scrubToken(await safeText(resp), token));` then throw `new Error(` + `maps.geocode: Mapbox returned ${resp.status}` + `);`. (`safeText` is a 1-liner that swallows `.text()` errors.)
   - `const data = await resp.json() as { features?: Array<{ center?: [number, number] }> };`
   - If `!data.features || data.features.length === 0 || !data.features[0].center`: throw `new Error(` + `maps.geocode: no results for ${address}` + `);` (matches the mock's implicit "bad input throws" shape — mock never throws today but the real adapter must treat "no results" as an error for `lib/office-geocode.ts`-style callers).
   - `const [lng, lat] = data.features[0].center;` — Mapbox returns `[lng, lat]`, our `LatLng` is `{ lat, lng }`.
   - Return `{ lat, lng }`.

7. **Implement `routeFor(params)`**:
   - Validate `params.stops.length >= 2`. If not, throw `new Error("maps.routeFor: need at least 2 stops");`. (The mock tolerates fewer, but Mapbox Directions requires ≥2 and a real call would 422.)
   - `const token = getToken();`
   - `const coordsPath = params.stops.map((s) => ` + `${s.lng},${s.lat}` + `).join(";");`
   - `const url = new URL(` + `${DIRECTIONS_BASE}/${coordsPath}` + `);`
   - `url.searchParams.set("access_token", token);`
   - `url.searchParams.set("geometries", "polyline");`
   - `url.searchParams.set("overview", "full");`
   - `const resp = await fetchWithTimeout(url, token);`
   - If `!resp.ok`: log scrubbed body + throw `new Error(` + `maps.routeFor: Mapbox returned ${resp.status}` + `);`.
   - `const data = await resp.json() as { routes?: Array<{ distance?: number; duration?: number; geometry?: string }> };`
   - If `!data.routes || data.routes.length === 0`: throw `new Error("maps.routeFor: no routes found");`.
   - `const r = data.routes[0];`
   - If `typeof r.distance !== "number" || typeof r.duration !== "number" || typeof r.geometry !== "string"`: throw `new Error("maps.routeFor: malformed route response");`.
   - Return `{ distanceMeters: r.distance, durationSeconds: r.duration, polyline: r.geometry }`.

8. **Implement `etaFor({ from, to })`**:
   - Build the same 2-stop Directions URL inline (do **not** call `routeFor`-through-`this`, to keep the call cheap — we can skip polyline and distance by using `overview=false` and parsing only `duration`).
   - `const token = getToken();`
   - `const coordsPath = ` + `${from.lng},${from.lat};${to.lng},${to.lat}` + `;`
   - `const url = new URL(` + `${DIRECTIONS_BASE}/${coordsPath}` + `);`
   - `url.searchParams.set("access_token", token);`
   - `url.searchParams.set("overview", "false");` — we only want duration; saves bandwidth.
   - `const resp = await fetchWithTimeout(url, token);`
   - If `!resp.ok`: log scrubbed body + throw `new Error(` + `maps.etaFor: Mapbox returned ${resp.status}` + `);`.
   - `const data = await resp.json() as { routes?: Array<{ duration?: number }> };`
   - If `!data.routes?.[0] || typeof data.routes[0].duration !== "number"`: throw `new Error("maps.etaFor: no route found");`.
   - Return `{ durationSeconds: data.routes[0].duration }`.

9. **Rewrite `interfaces/maps.ts`** to mirror `interfaces/auth.ts` + `interfaces/ai.ts`:
   - Keep the `LatLng`, `RouteFromStopsParams`, `RouteFromStopsResult`, `EtaParams`, `EtaResult`, `MapsService` exports unchanged.
   - Delete the `NotConfiguredError` import (no longer used here), the inline `notConfigured()` helper, and the inline `createRealMapsService` stub.
   - Append `export { createRealMapsService } from "./maps.real";` with a two-line comment matching the `auth.ts` / `ai.ts` re-exports: "The real adapter lives in a `\"server-only\"` module so webpack errors if anyone accidentally pulls it into a Client Component. Callers continue to import the interface + helper types from this file."
   - Confirm `mocks/maps.ts`'s `import type { ... } from "@/interfaces/maps"` still resolves — it will, since the type exports stay.
   - Confirm `interfaces/index.ts` already imports `createRealMapsService` from `./maps` — no change there.

10. **Write `interfaces/maps.real.test.ts`** (see **Tests to write**). Follow the `vi.stubEnv` + `vi.resetModules` + dynamic-import pattern used by `interfaces/ai.real.test.ts`. All HTTP is mocked via `vi.spyOn(globalThis, "fetch")`.

11. **Verify** locally (builder agent runs these, not planner):
    - `npx tsc --noEmit` — types clean.
    - `npx vitest run interfaces/maps.real.test.ts` — new test file green.
    - `npx vitest run` — full suite unaffected (including `interfaces/index.test.ts` which already covers `getServices` routing).

## Tests to write

All in `interfaces/maps.real.test.ts`. All use `vi.spyOn(globalThis, "fetch")` (or `vi.fn()` assigned to `globalThis.fetch`) plus `vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "pk.test-token-abc123")`; `vi.resetModules()` between env-mutating cases; `vi.unstubAllEnvs()` in `afterEach`. No real network.

**geocode**

- **"returns { lat, lng } on happy path"** — fetch resolves `Response` JSON `{ features: [{ center: [-74.12, 40.34] }] }`. Assert result is exactly `{ lat: 40.34, lng: -74.12 }`. Also assert the URL passed to `fetch` has host `api.mapbox.com`, path `/geocoding/v5/mapbox.places/...`, and query `limit=1`, `country=us`, `types=address%2Cplace`, plus `access_token=pk.test-token-abc123`.
- **"throws when Mapbox returns zero features"** — fetch resolves `{ features: [] }`. Assert rejects with `/no results for/` and the rejection message does NOT contain `"pk.test-token-abc123"`.
- **"throws generic error on non-2xx"** — fetch resolves `Response` with `status: 500` and a text body that **includes the token** (simulates Mapbox echoing the URL back). Assert rejects with `/Mapbox returned 500/`. Inspect every `console.error` call: no argument may include `"pk.test-token-abc123"` (regex defense — `expect(String(arg)).not.toMatch(/pk\.test-token-abc123/)`).
- **"URL-encodes address with spaces and special chars"** — call `geocode("123 Main St, Apt #4 & 5")`. Inspect `fetch.mock.calls[0][0].toString()`: the path segment must contain `%20`, `%23`, `%26`, **not** the literal space / `#` / `&`. Assert the path does not split on an un-encoded `&` into an unintended second query param.
- **"throws NotConfiguredError when NEXT_PUBLIC_MAPBOX_TOKEN is unset"** — `vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "")`, `vi.resetModules()`, re-import. Call `service.geocode("x")` — assert rejects with `NotConfiguredError` where `envVar === "NEXT_PUBLIC_MAPBOX_TOKEN"`. Also assert `fetch` was **not** called (lazy-throw at call time, but before any HTTP).

**routeFor**

- **"returns distance, duration, polyline on happy path"** — fetch resolves `{ routes: [{ distance: 12345.6, duration: 678.9, geometry: "abcXYZ" }] }`. Call `routeFor({ stops: [{ lat: 40, lng: -74 }, { lat: 40.1, lng: -74.1 }, { lat: 40.2, lng: -74.2 }] })`. Assert the URL path contains `-74,40;-74.1,40.1;-74.2,40.2` (note Mapbox order is `lng,lat`). Assert result `{ distanceMeters: 12345.6, durationSeconds: 678.9, polyline: "abcXYZ" }`.
- **"throws when Mapbox returns zero routes"** — fetch resolves `{ routes: [] }`. Assert rejects with `/no routes/`; no token in message.
- **"throws when called with fewer than 2 stops"** — call with `{ stops: [{ lat: 40, lng: -74 }] }`. Assert rejects with `/at least 2 stops/`. `fetch` must NOT be called.
- **"throws generic error on network failure"** — `fetch.mockRejectedValueOnce(new Error("ENETUNREACH api.mapbox.com?access_token=pk.test-token-abc123"))`. Assert rejects with an `Error` whose message does NOT contain `"pk.test-token-abc123"` (the scrub pass catches the token even when it leaks through from error text).

**etaFor**

- **"returns durationSeconds from routes[0]"** — fetch resolves `{ routes: [{ duration: 900 }] }`. Assert result `{ durationSeconds: 900 }`. Assert URL has `overview=false` (we skip polyline for ETA-only calls).

**cross-cutting**

- **"aborts requests after 10 seconds"** — use `vi.useFakeTimers()`. `fetch` implementation receives the `AbortSignal` and returns a promise that rejects when `signal.aborted` becomes true (simulate by resolving after `signal.aborted`). Call `service.geocode("slow")`, advance timers by `10_000`, assert the promise rejects with `/timed out/`. Then `vi.useRealTimers()`.
- **"access_token never appears in any console.error argument"** — parameterized sweep: for each of geocode / routeFor / etaFor, simulate a 500 response with the token embedded in the body. Collect every `console.error` call and flatten to strings. Assert `/pk\.test-token-abc123/` matches none. Run the same regex against any thrown `Error.message`. This is the defense-in-depth test called out in scope.
- **"URL construction never puts raw user input in the path"** — call `geocode("?access_token=evil&x=")` (adversarial query-param injection attempt). Inspect `fetch.mock.calls[0][0]` (a `URL` or `string`). Assert the parsed URL has exactly one `access_token` query value and it's `pk.test-token-abc123` (not `"evil"`), and the path segment contains the percent-encoded version of `?access_token=evil&x=`.

## External services touched

- **Mapbox** — REST endpoints `/geocoding/v5/mapbox.places/...` and `/directions/v5/mapbox/driving/...`, wrapped by `interfaces/maps.ts` (types + re-export) and `interfaces/maps.real.ts` (server-only `fetch`-based impl). Requires `NEXT_PUBLIC_MAPBOX_TOKEN` (a `pk.*` public-scoped token; public-safe but still treated as sensitive via scrubbing). Consumed from `lib/request-to-stop.ts` (ETA for newly-assigned stops) and `lib/heads-up.ts` (ETA check for 10-minute office heads-up), plus any future route-preview surface — all via `getServices().maps`.

No other external services are touched by this change. No new npm dependencies.

## Open questions

None.
