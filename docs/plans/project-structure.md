# Plan: Project Directory Structure

**Slug:** project-structure
**SPEC reference:** Tech stack + v1 features IN (foundation for driver route view, dispatcher portal, intake channels, admin CRUD, AI parsing — all of which need a shared home for types, interface seams, mocks, and SQL).
**Status:** draft

## Goal
Establish the repository's canonical top-level layout so every subsequent feature (auth, driver view, dispatcher map, intake channels, AI parsing, admin CRUD) has a known place to drop code, types, interfaces, mocks, SQL, and tests. This feature ships directory skeletons, READMEs stating what each directory is for, a shared `lib/types.ts` sketching the core domain, and a small `lib/ids.ts` helper with its test — no business logic, no routes, no interface implementations.

## Out of scope
- Any implementation of interfaces (SMS, email, Anthropic, Mapbox, Supabase wrappers) — each has its own later feature.
- Any route, page, server action, or API handler beyond what scaffold already placed.
- Supabase schema, migrations, RLS policies, seed data (the `supabase/` directory is created empty-with-README here; contents arrive in `supabase-setup`).
- Auth middleware, role-based route groups, session plumbing (later `auth` feature).
- Tailwind theme tokens, design system components (later UI features).
- Adding new npm dependencies. `lib/ids.ts` must be implementable with the standard library + what scaffold already installed (`vitest` for the test).
- Fleshing out domain types beyond the v1 sketch; fields can be refined per feature as they land.

## Files to create or modify

### Directory READMEs (new directories)
- `/Users/abraham/lab-dispatch/components/README.md` — explains this directory holds shared React components (presentational + small composite). Route-specific components live colocated under `app/`.
- `/Users/abraham/lab-dispatch/lib/README.md` — explains this directory holds pure TypeScript helpers, domain types, and interface wrappers around external services. No React, no JSX.
- `/Users/abraham/lab-dispatch/interfaces/README.md` — explains this directory declares the TypeScript interfaces (ports) that wrap external services (SMS, email, AI, maps, storage). Implementations live in `lib/`; mocks live in `mocks/`.
- `/Users/abraham/lab-dispatch/mocks/README.md` — explains this directory holds in-memory/fake implementations of the `interfaces/` ports, used by tests and local dev. Never imported from production code paths.
- `/Users/abraham/lab-dispatch/tests/README.md` — explains this directory holds integration/e2e-level tests that span multiple modules. Unit tests stay colocated next to their source (e.g. `lib/ids.test.ts`, `app/__tests__/page.test.tsx`).
- `/Users/abraham/lab-dispatch/supabase/README.md` — explains this directory holds SQL migrations, policies, and seed scripts for the Supabase project. Code that talks to Supabase lives in `lib/`.

### App route group conventions (documentation only, no new route files)
- `/Users/abraham/lab-dispatch/app/README.md` — documents Next.js App Router conventions used by this project: planned route groups `(marketing)`, `(auth)`, `(app)` will be introduced by their owning features (auth, driver, dispatcher, admin). This feature does NOT create those group directories — it only documents the naming convention so later features are consistent. Colocated `__tests__/` directories are allowed.

### Domain types and helpers (new source files)
- `/Users/abraham/lab-dispatch/lib/types.ts` — type-only module exporting the v1 domain sketch:
  - `UserRole` — `"driver" | "dispatcher" | "admin"`
  - `Driver` — id, userId, name, phone, active flag, createdAt
  - `Doctor` — id, officeId, name, contact fields (phone, email optional)
  - `Office` — id, name, slug, address (street, city, state, zip), lat/lng optional, pickupUrlToken, phone, email
  - `PickupRequest` — id, officeId, channel (`"sms" | "email" | "web"`), urgency (`"routine" | "urgent" | "stat"`), sampleCount (optional), notes, rawMessage (optional), status (`"pending" | "scheduled" | "en_route" | "picked_up" | "cancelled" | "flagged"`), createdAt
  - `Stop` — id, routeId, pickupRequestId, officeId, sequence (number), etaAt, arrivedAt (optional), pickedUpAt (optional)
  - `Route` — id, driverId, date (ISO), status (`"draft" | "assigned" | "active" | "completed"`), startedAt (optional), completedAt (optional), stops: `Stop[]` (embedded for convenience — joins happen in the data layer)
- `/Users/abraham/lab-dispatch/lib/ids.ts` — exports `makeSlugId(slug: string, size?: number): string` producing `"{normalized-slug}-{random}"`. Random suffix is a lowercase base36 string of length `size` (default 8) using `crypto.getRandomValues` (available in Node 20 and browsers). Slug normalization: lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing `-`, collapse repeats. Exports a second helper `makeRandomId(size?: number): string` for callers that don't need a slug prefix.
- `/Users/abraham/lab-dispatch/lib/ids.test.ts` — Vitest unit test file colocated with the source (see tests section).

### Modifications to existing files
- None. Scaffold's `tsconfig.json` already provides the `@/*` path alias rooted at the repo, so `@/lib/types` and `@/lib/ids` resolve automatically without config changes.

## Interfaces / contracts

### Types exported from `@/lib/types`
```ts
export type UserRole = "driver" | "dispatcher" | "admin";

export interface Driver {
  id: string;
  userId: string;        // Supabase auth user id
  name: string;
  phone: string;
  active: boolean;
  createdAt: string;     // ISO timestamp
}

export interface Doctor {
  id: string;
  officeId: string;
  name: string;
  phone?: string;
  email?: string;
}

export interface Office {
  id: string;
  name: string;
  slug: string;                // used in pickup URL
  pickupUrlToken: string;      // random suffix paired with slug
  address: {
    street: string;
    city: string;
    state: string;             // 2-letter US state
    zip: string;
  };
  lat?: number;
  lng?: number;
  phone?: string;
  email?: string;
}

export type PickupChannel = "sms" | "email" | "web";
export type PickupUrgency = "routine" | "urgent" | "stat";
export type PickupStatus =
  | "pending"
  | "scheduled"
  | "en_route"
  | "picked_up"
  | "cancelled"
  | "flagged";

export interface PickupRequest {
  id: string;
  officeId: string;
  channel: PickupChannel;
  urgency: PickupUrgency;
  sampleCount?: number;
  notes?: string;
  rawMessage?: string;         // original SMS/email body, if applicable
  status: PickupStatus;
  createdAt: string;
}

export interface Stop {
  id: string;
  routeId: string;
  pickupRequestId: string;
  officeId: string;
  sequence: number;
  etaAt?: string;
  arrivedAt?: string;
  pickedUpAt?: string;
}

export type RouteStatus = "draft" | "assigned" | "active" | "completed";

export interface Route {
  id: string;
  driverId: string;
  date: string;                // ISO date (yyyy-mm-dd)
  status: RouteStatus;
  startedAt?: string;
  completedAt?: string;
  stops: Stop[];
}
```

### Functions exported from `@/lib/ids`
```ts
export function makeRandomId(size?: number): string;
export function makeSlugId(slug: string, size?: number): string;
```
- `makeRandomId(size = 8)` — returns a lowercase base36 string of exactly `size` characters drawn from `crypto.getRandomValues`. Throws `RangeError` if `size < 1` or `size > 32`.
- `makeSlugId(slug, size = 8)` — returns `` `${normalize(slug)}-${makeRandomId(size)}` ``. Throws `Error` if the normalized slug is empty.

No API routes, no React components, no server actions in this feature.

## Implementation steps
1. Create `/Users/abraham/lab-dispatch/components/` with a single-paragraph `README.md` stating its purpose (shared presentational and composite React components used across routes; route-specific UI stays colocated inside `app/`; no business logic or data fetching beyond props).
2. Create `/Users/abraham/lab-dispatch/lib/` with a single-paragraph `README.md` stating its purpose (pure TypeScript helpers, domain types, and concrete implementations of `interfaces/` ports; no React, no JSX, no direct DOM access; safe to import from both server and client unless a module is marked otherwise).
3. Create `/Users/abraham/lab-dispatch/interfaces/` with a single-paragraph `README.md` stating its purpose (TypeScript interface declarations — "ports" — for every external service the app talks to: SMS, inbound email, AI parser, maps, storage. Only types live here. Implementations live in `lib/`; test fakes live in `mocks/`).
4. Create `/Users/abraham/lab-dispatch/mocks/` with a single-paragraph `README.md` stating its purpose (in-memory/fake implementations of ports declared in `interfaces/`, used by tests and local dev; must never be imported from production code; one file per interface when added).
5. Create `/Users/abraham/lab-dispatch/tests/` with a single-paragraph `README.md` stating its purpose (integration and end-to-end tests that span multiple modules or exercise full request flows; unit tests stay colocated next to the module under test).
6. Create `/Users/abraham/lab-dispatch/supabase/` with a single-paragraph `README.md` stating its purpose (SQL migrations, RLS policies, and seed scripts for the Supabase project; application code that talks to Supabase lives in `lib/`, never here).
7. Create `/Users/abraham/lab-dispatch/app/README.md` documenting the route group naming convention (`(marketing)`, `(auth)`, `(app)`) that later features will introduce, plus the colocated-tests convention (`__tests__/` directories next to routes). No route group directories are created in this step.
8. Create `/Users/abraham/lab-dispatch/lib/types.ts` containing only the type/interface declarations listed under "Interfaces / contracts" above. File must have zero runtime exports — verify with `grep -nE '^(export (function|const|let|var|class))' lib/types.ts` returning no matches.
9. Create `/Users/abraham/lab-dispatch/lib/ids.ts` implementing `makeRandomId` and `makeSlugId` per the contract. Use `globalThis.crypto.getRandomValues(new Uint8Array(n))` to source randomness; convert bytes to base36 and slice to `size`. Normalize slug with a single regex pass: `slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`. Throw on empty normalized slug or out-of-range `size`.
10. Create `/Users/abraham/lab-dispatch/lib/ids.test.ts` covering the three behaviors listed in "Tests to write" below.
11. Run the scaffold gate: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. All four must stay green. The new test must appear in Vitest's run output and pass.

## Tests to write
- `/Users/abraham/lab-dispatch/lib/ids.test.ts` — Vitest unit tests, three cases:
  1. **Format — `makeRandomId`**: calling with default size returns a string of length 8 matching `/^[a-z0-9]{8}$/`; calling with size 16 returns length 16 matching the same character class; calling with size 0 or 33 throws `RangeError`.
  2. **Format — `makeSlugId`**: `makeSlugId("Dr. Smith's Office!")` returns a string matching `/^dr-smith-s-office-[a-z0-9]{8}$/`; `makeSlugId("   ")` throws; passing explicit size flows through to the suffix length.
  3. **Uniqueness**: generating 1,000 ids via `makeRandomId()` and 1,000 via `makeSlugId("office")` yields zero duplicates in each set (collision probability at size 8 over 1,000 draws is negligible; if flake is ever observed, bump size — but the test itself stays at size 8 to also guard the default).

No integration tests yet — `tests/` is created empty-with-README; its first contents arrive with the first cross-module feature.

## External services touched
None. This feature introduces no SDK, no network client, no environment variables. `crypto.getRandomValues` is a standard Web Crypto API available in Node 20 and all supported browsers.

## Open questions
None.
