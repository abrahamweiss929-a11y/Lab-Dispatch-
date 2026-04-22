# Plan: Interface Layer for External Services

**Slug:** interface-layer
**SPEC reference:** Tech stack (Twilio, Postmark/SendGrid, Supabase, Mapbox, Anthropic). Foundational seam for v1 features IN — pickup channels (SMS/email/web), AI parsing, auto-confirmations, live tracking, route assignment, logins, admin CRUD. Builds on `project-structure` (which created `interfaces/` + `mocks/` with READMEs) and `db-schema` (which fixed Postgres vocabulary).
**Status:** draft

## Goal
Introduce a port-and-adapter seam between application code and every external service (SMS, email, storage, maps, AI, auth) so v1 feature work can proceed offline against deterministic mocks while real implementations remain a stub that fails loudly until credentials arrive. Every service lands as three artifacts: an interface + real stub in `interfaces/`, a mock in `mocks/`, and colocated tests. A central `getServices()` factory, switched by `USE_MOCKS`, wires the right set.

## Out of scope
- Any real SDK calls. Real adapters are stubs that throw `NotConfiguredError`; wiring them to Twilio/Postmark/Supabase/Mapbox/Anthropic is deferred to each service's "real-<service>" feature.
- RLS policies or Supabase Auth configuration (redirect URLs, email templates, providers). The `auth` interface wraps a local in-memory session only; real Supabase Auth plumbing lands with the `auth` feature.
- Inbound webhook HTTP routes (e.g. `POST /api/webhooks/twilio`, `POST /api/webhooks/postmark`). This feature defines the inbound payload types, not the routes; routes land with the intake-channel features.
- Background jobs, scheduled senders, retry/backoff policies. Mocks resolve synchronously (or with microtask delay); real wrappers will add retry logic later.
- Production DI container. `getServices()` is a tiny factory, not a framework — swap-in happens at the module boundary.
- Generated Supabase TS types (`supabase gen types`). Storage mock/real both speak the hand-written domain types in `lib/types.ts`.
- Reconciling every divergence between `lib/types.ts` and `supabase/schema.sql` — this feature reconciles only the types touched by the storage interface's nine methods (offices, drivers, doctors, pickup requests) and flags the rest as Open Questions. `Route`/`Stop`/`RouteStatus` stay as currently sketched until a feature needs them.
- Adding new npm dependencies. Everything here is hand-written TypeScript plus what scaffold installed (`vitest`).

## Files to create or modify

### New: shared error + factory
- `/Users/abraham/lab-dispatch/lib/errors.ts` — exports `NotConfiguredError` class (subclass of `Error`, fixed `name = "NotConfiguredError"`, constructor takes `{ service: string; envVar: string }` and formats message `"{service} is not configured — see BLOCKERS.md and set ${envVar}"`).
- `/Users/abraham/lab-dispatch/lib/errors.test.ts` — asserts name, message format, and that it is an `instanceof Error` + `instanceof NotConfiguredError`.
- `/Users/abraham/lab-dispatch/interfaces/index.ts` — exports:
  - `Services` type = `{ sms: SmsService; email: EmailService; storage: StorageService; maps: MapsService; ai: AiService; auth: AuthService }`
  - `getServices(): Services` — reads `process.env.USE_MOCKS` (treat unset and `"true"` as mock mode; `"false"` as real mode; any other value throws to prevent silent mistakes)
  - `resetAllMocks()` — convenience re-export that calls each mock module's `reset*` function (used by test setup).
- `/Users/abraham/lab-dispatch/interfaces/index.test.ts` — verifies factory behavior under `USE_MOCKS` unset / `"true"` / `"false"` / invalid.

### New: per-service interface + real stub (one file each)
- `/Users/abraham/lab-dispatch/interfaces/sms.ts`
- `/Users/abraham/lab-dispatch/interfaces/email.ts`
- `/Users/abraham/lab-dispatch/interfaces/storage.ts`
- `/Users/abraham/lab-dispatch/interfaces/maps.ts`
- `/Users/abraham/lab-dispatch/interfaces/ai.ts`
- `/Users/abraham/lab-dispatch/interfaces/auth.ts`

Each exports: (a) the TypeScript `interface` for the port, (b) any payload/param types, (c) a `createReal<Service>Service()` factory that returns an object whose every method throws `NotConfiguredError` with the right env-var name. No SDK imports.

### New: per-service mock (one file each)
- `/Users/abraham/lab-dispatch/mocks/sms.ts`
- `/Users/abraham/lab-dispatch/mocks/email.ts`
- `/Users/abraham/lab-dispatch/mocks/storage.ts`
- `/Users/abraham/lab-dispatch/mocks/maps.ts`
- `/Users/abraham/lab-dispatch/mocks/ai.ts`
- `/Users/abraham/lab-dispatch/mocks/auth.ts`

Each mock exports (a) a singleton instance (`export const smsMock`) implementing the interface, (b) a `reset<Service>Mock()` function clearing its in-memory state, (c) test-only inspection helpers as spelled out per service below.

### New: colocated tests (one per mock + one for the factory)
- `/Users/abraham/lab-dispatch/mocks/sms.test.ts`
- `/Users/abraham/lab-dispatch/mocks/email.test.ts`
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts`
- `/Users/abraham/lab-dispatch/mocks/maps.test.ts`
- `/Users/abraham/lab-dispatch/mocks/ai.test.ts`
- `/Users/abraham/lab-dispatch/mocks/auth.test.ts`
- `/Users/abraham/lab-dispatch/interfaces/index.test.ts` (listed above)

### Modifications
- `/Users/abraham/lab-dispatch/lib/types.ts` — reconcile with `supabase/schema.sql` for the four tables touched by the storage interface:
  - `PickupChannel` — add `"manual"` to match `request_channel` enum.
  - `PickupStatus` — narrow to `"pending" | "assigned" | "completed" | "flagged"` to match `request_status` enum (DB is authoritative per the db-schema plan's resolution of its Open Question #1).
  - `PickupRequest` — rename `notes` → `specialInstructions`; add `sourceIdentifier?: string`, `flaggedReason?: string`, `updatedAt: string` to match the columns needed by `createPickupRequest`/`updatePickupRequestStatus`. Keep `rawMessage?: string`.
  - `Driver` — change shape to mirror `profiles` + `drivers` join: `{ profileId: string; fullName: string; phone?: string; vehicleLabel?: string; active: boolean; createdAt: string }`. Drop the old `userId`/`name` fields (no callers yet).
  - `Office` — no structural change; optional-fields stay compatible with the schema's nullable columns.
  - `Doctor` — no change; already matches.
  - `Route`/`Stop`/`RouteStatus` — **no change in this feature**; listed in Open Questions for a later reconciliation when a route-touching feature lands.
- `/Users/abraham/lab-dispatch/lib/schema.test.ts` — no edits expected; types changes do not affect the SQL shape tests. If a reviewer adds a type-vs-SQL cross-check here later, it is additive.
- `/Users/abraham/lab-dispatch/vitest.setup.ts` — add `beforeEach(() => { resetAllMocks(); })` so every test starts with clean mock state. Import `resetAllMocks` from `@/interfaces`.
- `/Users/abraham/lab-dispatch/BLOCKERS.md` — add five entries (one per real service) under "Unresolved", following the documented pattern.
- `/Users/abraham/lab-dispatch/BUILD_LOG.md` — append one dated entry describing what shipped in this feature. (Existing repo convention; no changes to the file's format.)

## Interfaces / contracts

### `lib/errors.ts`
```ts
export class NotConfiguredError extends Error {
  readonly service: string;
  readonly envVar: string;
  constructor(args: { service: string; envVar: string }) {
    super(`${args.service} is not configured — see BLOCKERS.md and set ${args.envVar}`);
    this.name = "NotConfiguredError";
    this.service = args.service;
    this.envVar = args.envVar;
  }
}
```

### `interfaces/sms.ts`
```ts
export interface SmsSendParams { to: string; body: string; }
export interface SmsSendResult { id: string; status: "queued"; }
export interface SentSmsRecord extends SmsSendParams, SmsSendResult { sentAt: string; }

export interface SmsService {
  sendSms(params: SmsSendParams): Promise<SmsSendResult>;
}

export function createRealSmsService(): SmsService; // throws on sendSms
```
Real stub throws `new NotConfiguredError({ service: "sms (Twilio)", envVar: "TWILIO_ACCOUNT_SID" })`. (One env-var name per throw is sufficient; BLOCKERS.md lists the full triple.)

### `interfaces/email.ts`
```ts
export interface EmailSendParams { to: string; subject: string; body: string; }
export interface EmailSendResult { id: string; }
export interface SentEmailRecord extends EmailSendParams, EmailSendResult { sentAt: string; }

export interface InboundEmailPayload {
  from: string;             // sender email
  to: string;               // recipient email (e.g. pickup@ourlab.com)
  subject: string;
  body: string;             // plain-text body; HTML stripping is the intake feature's job
  receivedAt: string;       // ISO timestamp
  messageId: string;        // vendor-provided id for dedupe
}

export interface EmailService {
  sendEmail(params: EmailSendParams): Promise<EmailSendResult>;
}

export function createRealEmailService(): EmailService; // throws on sendEmail
```
Real stub throws with `envVar: "POSTMARK_SERVER_TOKEN"`.

### `interfaces/storage.ts`
```ts
import type { Office, Driver, Doctor, PickupRequest, PickupStatus } from "@/lib/types";

export interface ListPickupRequestsFilter { status?: PickupStatus; }

export type NewOffice = Omit<Office, "id">;
export type NewDriver = Omit<Driver, "profileId" | "createdAt"> & { profileId: string };
export type NewDoctor = Omit<Doctor, "id">;
export type NewPickupRequest = Omit<PickupRequest, "id" | "status" | "createdAt" | "updatedAt">
  & { status?: PickupStatus };

export interface StorageService {
  listOffices(): Promise<Office[]>;
  listDrivers(): Promise<Driver[]>;
  listDoctors(): Promise<Doctor[]>;
  listPickupRequests(filter?: ListPickupRequestsFilter): Promise<PickupRequest[]>;

  createOffice(input: NewOffice): Promise<Office>;
  createDriver(input: NewDriver): Promise<Driver>;
  createDoctor(input: NewDoctor): Promise<Doctor>;
  createPickupRequest(input: NewPickupRequest): Promise<PickupRequest>;
  updatePickupRequestStatus(id: string, status: PickupStatus): Promise<PickupRequest>;
}

export function createRealStorageService(): StorageService; // every method throws
```
Real stub throws with `envVar: "NEXT_PUBLIC_SUPABASE_URL"` (the first of three Supabase vars listed in BLOCKERS; see that file for the full set).

### `interfaces/maps.ts`
```ts
export interface LatLng { lat: number; lng: number; }
export interface RouteFromStopsParams { stops: LatLng[]; }
export interface RouteFromStopsResult { distanceMeters: number; durationSeconds: number; polyline: string; }
export interface EtaParams { from: LatLng; to: LatLng; }
export interface EtaResult { durationSeconds: number; }

export interface MapsService {
  geocode(address: string): Promise<LatLng>;
  routeFor(params: RouteFromStopsParams): Promise<RouteFromStopsResult>;
  etaFor(params: EtaParams): Promise<EtaResult>;
}

export function createRealMapsService(): MapsService; // every method throws
```
Real stub throws with `envVar: "NEXT_PUBLIC_MAPBOX_TOKEN"`.

### `interfaces/ai.ts`
```ts
import type { PickupChannel, PickupUrgency } from "@/lib/types";

export interface ParsePickupMessageParams {
  channel: PickupChannel;       // "sms" | "email" | "web" | "manual"
  from: string;                 // phone or email
  body: string;                 // message text
}

export interface ParsePickupMessageResult {
  urgency?: PickupUrgency;
  sampleCount?: number;
  specialInstructions?: string;
  confidence: number;           // 0..1
}

export interface AiService {
  parsePickupMessage(params: ParsePickupMessageParams): Promise<ParsePickupMessageResult>;
}

export function createRealAiService(): AiService; // throws on parsePickupMessage
```
Real stub throws with `envVar: "ANTHROPIC_API_KEY"`.

### `interfaces/auth.ts`
```ts
import type { UserRole } from "@/lib/types";

export interface SignInParams { email: string; password: string; }
export interface Session { userId: string; role: UserRole; }

export interface AuthService {
  signIn(params: SignInParams): Promise<Session>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<Session | null>;
}

export function createRealAuthService(): AuthService; // every method throws
```
Real stub throws with `envVar: "NEXT_PUBLIC_SUPABASE_URL"` (shared with storage; BLOCKERS lists all three Supabase vars under the same entry).

### `interfaces/index.ts`
```ts
export interface Services {
  sms: SmsService;
  email: EmailService;
  storage: StorageService;
  maps: MapsService;
  ai: AiService;
  auth: AuthService;
}

export function getServices(): Services;
export function resetAllMocks(): void;
```
Behavior:
- `USE_MOCKS` unset or `"true"` → returns mock singletons.
- `USE_MOCKS === "false"` → returns objects from `createReal<Service>Service()`.
- Any other value → throws `Error("USE_MOCKS must be 'true' or 'false', got: <value>")`.

## Implementation steps
1. **Error type.** Create `/Users/abraham/lab-dispatch/lib/errors.ts` with `NotConfiguredError`. Create `/Users/abraham/lab-dispatch/lib/errors.test.ts` asserting `name`, message format, and inheritance. Run `npm run test` — it must pass before touching anything else.
2. **Reconcile `lib/types.ts`.** Edit `/Users/abraham/lab-dispatch/lib/types.ts` per the bullet list under "Modifications" above. Four tables only: `PickupChannel`, `PickupStatus`, `PickupRequest`, `Driver`. Leave `Route`/`Stop`/`RouteStatus` alone. Keep `OfficeAddress` and `Office` unchanged. Run `npm run typecheck` — it must pass (no callers depend on the renamed/dropped fields yet, confirmed by `grep -r "\.notes\b" app lib interfaces mocks tests` returning nothing before this step).
3. **SMS interface + real stub.** Create `/Users/abraham/lab-dispatch/interfaces/sms.ts` with the interface, param/result/record types, and `createRealSmsService()` returning `{ sendSms: () => { throw new NotConfiguredError({ service: "sms (Twilio)", envVar: "TWILIO_ACCOUNT_SID" }); } }`. No runtime imports beyond `@/lib/errors`.
4. **SMS mock.** Create `/Users/abraham/lab-dispatch/mocks/sms.ts` exporting `smsMock: SmsService` with an internal `SentSmsRecord[]` array. `sendSms` pushes a record with id `\`sms-mock-${counter++}\`` and `status: "queued"` and resolves with `{ id, status }`. Export `getSent(): readonly SentSmsRecord[]` and `resetSmsMock()` (clears array, resets counter). Singleton pattern: one module-scoped `state` object, exports reference its methods.
5. **SMS test.** Create `/Users/abraham/lab-dispatch/mocks/sms.test.ts`. Happy path: `sendSms({ to: "+15551234567", body: "hi" })` returns an id starting `sms-mock-`, status `"queued"`, and `getSent()` shows one record with matching `to`/`body`/`sentAt`. Edge: sending two messages produces deterministic sequential ids (`sms-mock-0`, `sms-mock-1`) and `resetSmsMock()` clears `getSent()` and resets the counter so the next send is `sms-mock-0` again.
6. **Email interface + real stub + mock + test.** Mirror steps 3–5 for `/Users/abraham/lab-dispatch/interfaces/email.ts`, `/Users/abraham/lab-dispatch/mocks/email.ts`, `/Users/abraham/lab-dispatch/mocks/email.test.ts`. Include the `InboundEmailPayload` type in the interface file. Real stub env-var: `POSTMARK_SERVER_TOKEN`. Mock ids: `email-mock-0`, etc. Edge case in test: empty `subject` is allowed; `to` must be a non-empty string (mock throws `Error("to is required")` if empty — this is a mock-side defensive check, not an interface-level validation).
7. **Storage interface + real stub.** Create `/Users/abraham/lab-dispatch/interfaces/storage.ts` with the full interface and `NewOffice`/`NewDriver`/`NewDoctor`/`NewPickupRequest` helper types per the contracts section. `createRealStorageService()` returns an object where every one of the nine methods throws `NotConfiguredError` with `envVar: "NEXT_PUBLIC_SUPABASE_URL"`.
8. **Storage mock.** Create `/Users/abraham/lab-dispatch/mocks/storage.ts`. Internal state: four `Map<string, T>` keyed by id for `offices`, `drivers` (key: `profileId`), `doctors`, `pickupRequests`. Helpers:
   - `createOffice(input)` → generates id via `makeRandomId()` from `@/lib/ids`, stores, returns the full `Office`.
   - `createDriver(input)` → stores under `input.profileId`, sets `createdAt = new Date().toISOString()`, returns `Driver`.
   - `createDoctor(input)` → generates id, stores, returns `Doctor`.
   - `createPickupRequest(input)` → generates id, sets `status = input.status ?? "pending"`, sets `createdAt = updatedAt = now`, stores, returns `PickupRequest`.
   - `updatePickupRequestStatus(id, status)` → throws `Error("pickup request {id} not found")` if missing; otherwise updates `status` and `updatedAt`, returns the mutated record (new object, not a mutation of the stored map entry — store a replacement).
   - `listOffices/listDrivers/listDoctors` → return arrays of `.values()` sorted ascending by a stable key (createdAt for driver/pickup; name for offices/doctors — pick one and keep it deterministic so tests are stable).
   - `listPickupRequests({ status })` → if `status` provided, filter; otherwise return all, sorted by `createdAt` descending so the dispatcher queue is newest-first.
   - `resetStorageMock()` → clears all four maps.
9. **Storage test.** Create `/Users/abraham/lab-dispatch/mocks/storage.test.ts`. Happy paths: one per `create*` (round-trip: create then list shows it) and one `listPickupRequests({ status: "pending" })` that seeds two pickups with different statuses and asserts the filter works. Edge: `updatePickupRequestStatus("does-not-exist", "completed")` rejects with an Error whose message contains "not found"; `updatePickupRequestStatus` updates `updatedAt` and leaves `createdAt` unchanged.
10. **Maps interface + real stub + mock + test.** Create `/Users/abraham/lab-dispatch/interfaces/maps.ts` per the contract. Real stub env-var: `NEXT_PUBLIC_MAPBOX_TOKEN`. Create `/Users/abraham/lab-dispatch/mocks/maps.ts`:
    - `geocode(address)` — deterministic hash of the address string to a fixed point grid centered on a plausible US location (e.g. base `{ lat: 40.0, lng: -74.0 }` plus a small offset computed by summing char codes mod a small range). Document the math in a comment so tests can predict output.
    - `routeFor({ stops })` — distance = `stops.length * 1000` meters, duration = `stops.length * 120` seconds, polyline = `"mock-polyline:" + stops.map(s => \`${s.lat},${s.lng}\`).join("|")`.
    - `etaFor({ from, to })` — duration = `Math.round(haversine(from, to) * 60)` seconds (haversine implemented inline; small helper, no deps). Deterministic per-input.
    - `resetMapsMock()` — no-op (maps mock is stateless) but exported for uniformity so `resetAllMocks()` can call it without a special case.
    Create `/Users/abraham/lab-dispatch/mocks/maps.test.ts`. Happy: `geocode` returns the documented value for `"100 Main St, Princeton, NJ"`; `routeFor({ stops: [a, b, c] })` returns `distanceMeters: 3000, durationSeconds: 360`; `etaFor` is symmetric (`eta(a, b) === eta(b, a)`). Edge: `routeFor({ stops: [] })` returns zeros and an empty polyline (`"mock-polyline:"`) — document this as the defined behavior, not an error.
11. **AI interface + real stub + mock + test.** Create `/Users/abraham/lab-dispatch/interfaces/ai.ts` per the contract. Real stub env-var: `ANTHROPIC_API_KEY`. Create `/Users/abraham/lab-dispatch/mocks/ai.ts` with `parsePickupMessage` implementing these deterministic rules on the lowercased `body`:
    - Urgency: contains `"stat"` → `"stat"`; contains `"urgent"`/`"asap"`/`"rush"` → `"urgent"`; otherwise → `"routine"`.
    - Sample count: first integer 1..99 found via `/\b(\d{1,2})\b/` → that number; otherwise `undefined`.
    - Special instructions: everything after the first newline, trimmed; if no newline, `undefined`.
    - Confidence: starts at 0.9; subtract 0.2 if urgency was inferred from neither `stat`/`urgent` keyword (i.e. defaulted to `"routine"`); subtract 0.2 if `sampleCount` is undefined. Floor at 0.5.
    - `resetAiMock()` — no-op but exported.
    Create `/Users/abraham/lab-dispatch/mocks/ai.test.ts`. Happy: `"3 samples, STAT"` parses to `{ urgency: "stat", sampleCount: 3, confidence: 0.9 }`; `"morning pickup please\nleave at back door"` parses to routine with `specialInstructions: "leave at back door"`. Edge: `""` parses to routine with undefined sampleCount and confidence 0.5.
12. **Auth interface + real stub + mock + test.** Create `/Users/abraham/lab-dispatch/interfaces/auth.ts` per the contract. Real stub env-var: `NEXT_PUBLIC_SUPABASE_URL`. Create `/Users/abraham/lab-dispatch/mocks/auth.ts`:
    - Internal seeded map: `"driver@test" → { userId: "user-driver", role: "driver" }`, `"dispatcher@test" → { userId: "user-dispatcher", role: "dispatcher" }`, `"admin@test" → { userId: "user-admin", role: "admin" }`. All three passwords are `"test1234"` (constant; document that this is mock-only).
    - `signIn({ email, password })` — case-insensitive email lookup; on miss or wrong password reject with `Error("invalid credentials")`; on hit set an internal `currentSession` and resolve with `{ userId, role }`.
    - `signOut()` — sets `currentSession = null`; resolves void. Idempotent.
    - `getCurrentUser()` — resolves with `currentSession` (or null).
    - `resetAuthMock()` — clears `currentSession` but preserves the seeded accounts (do NOT let tests mutate the seed; if they need a new account, add a test-only helper later).
    Create `/Users/abraham/lab-dispatch/mocks/auth.test.ts`. Happy: sign in as each of the three accounts, `getCurrentUser()` reflects it, `signOut()` clears it. Edge: wrong password rejects; sign in is case-insensitive (`"Driver@Test"` works).
13. **Factory.** Create `/Users/abraham/lab-dispatch/interfaces/index.ts` per the contract. Import each interface and mock module; in `getServices()` branch on `process.env.USE_MOCKS`. `resetAllMocks()` calls the six `reset*` functions in fixed order (sms, email, storage, maps, ai, auth). Export the `Services` type, the `getServices` function, `resetAllMocks`, plus re-export the per-service interface and payload types (`SmsService`, `SmsSendParams`, `EmailService`, `InboundEmailPayload`, `StorageService`, `MapsService`, `AiService`, `AuthService`, `Session`, etc.) so consumers import one place.
14. **Factory test.** Create `/Users/abraham/lab-dispatch/interfaces/index.test.ts`. Use `vi.stubEnv`/`vi.unstubAllEnvs` (available in Vitest 1.x) to flip `USE_MOCKS` inside each `it`. Cases:
    - Unset → `getServices().sms.sendSms(...)` resolves and `smsMock.getSent()` grows. (Proves mocks returned.)
    - `"true"` → same as unset.
    - `"false"` → `await expect(getServices().sms.sendSms(...)).rejects.toBeInstanceOf(NotConfiguredError)`; the thrown error's `envVar` is `"TWILIO_ACCOUNT_SID"`.
    - Invalid (`"yes"`) → calling `getServices()` throws a clear error.
    Also verify `resetAllMocks()` clears `smsMock.getSent()` after a send.
15. **Global setup.** Edit `/Users/abraham/lab-dispatch/vitest.setup.ts` to add `import { beforeEach } from "vitest"; import { resetAllMocks } from "@/interfaces"; beforeEach(() => resetAllMocks());`. This guarantees per-test isolation across the whole suite.
16. **BLOCKERS.md.** Replace the "_None yet._" placeholder under "Unresolved" with five entries, one per service, in the documented pattern. Entries (slugs used): `twilio-sms`, `inbound-email`, `supabase`, `mapbox`, `anthropic`. Each names: Type (API key + account), Needed for (which v1 feature rolls), What to provide (exact env var names), Where it plugs in (file paths), Workaround in place (mock details).
    - `twilio-sms`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`; plugs into `interfaces/sms.ts` real impl; workaround: `mocks/sms.ts` stores sends in memory with deterministic ids.
    - `inbound-email`: `POSTMARK_SERVER_TOKEN` (or `SENDGRID_API_KEY` — pick one when the user decides; note both in the entry); plugs into `interfaces/email.ts`; workaround: `mocks/email.ts`.
    - `supabase`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; plugs into `interfaces/storage.ts` and `interfaces/auth.ts`; workaround: `mocks/storage.ts` in-memory Maps, `mocks/auth.ts` seeded sessions.
    - `mapbox`: `NEXT_PUBLIC_MAPBOX_TOKEN`; plugs into `interfaces/maps.ts`; workaround: deterministic fake geocode/route/eta.
    - `anthropic`: `ANTHROPIC_API_KEY`; plugs into `interfaces/ai.ts`; workaround: keyword-heuristic parser in `mocks/ai.ts`.
17. **BUILD_LOG.md.** Append a dated entry summarizing this feature: files created, the factory switch, the per-service env-var wiring into BLOCKERS, and a reminder that real adapters are stubs. Match the existing BUILD_LOG entry format (read the file first if any prior entries exist; otherwise establish a simple dated-heading format).
18. **Verification gate.** Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. All four must pass. The seven new test files must all show up in Vitest output and pass. Fix any TypeScript errors from the `lib/types.ts` reconciliation before declaring done.

## Tests to write
- `/Users/abraham/lab-dispatch/lib/errors.test.ts` — `NotConfiguredError` name, message, instanceof chain.
- `/Users/abraham/lab-dispatch/mocks/sms.test.ts` — happy path (round-trip via `getSent()`), deterministic ids + reset, two sends produce two records.
- `/Users/abraham/lab-dispatch/mocks/email.test.ts` — happy path, deterministic ids + reset, empty `to` rejects.
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — round-trip create+list for each of offices/drivers/doctors/pickup_requests; `listPickupRequests({ status })` filter; `updatePickupRequestStatus` missing-id error; `updatedAt` changes while `createdAt` stays.
- `/Users/abraham/lab-dispatch/mocks/maps.test.ts` — `geocode` deterministic output for a fixed input; `routeFor` math; `etaFor` symmetry; empty-stops edge case.
- `/Users/abraham/lab-dispatch/mocks/ai.test.ts` — STAT urgency + sample count parsing; routine with special instructions after newline; empty body → floor confidence.
- `/Users/abraham/lab-dispatch/mocks/auth.test.ts` — sign in/out round-trip for each of three seeded accounts; wrong password rejects; case-insensitive email.
- `/Users/abraham/lab-dispatch/interfaces/index.test.ts` — `getServices()` returns mocks when `USE_MOCKS` unset / `"true"`; real stubs that throw `NotConfiguredError` when `"false"`; invalid value errors; `resetAllMocks()` clears across services.

## External services touched
- **SMS** — Twilio. Wrapped by `interfaces/sms.ts`; mock `mocks/sms.ts`.
- **Email** — Postmark (or SendGrid) inbound + outbound. Wrapped by `interfaces/email.ts`; mock `mocks/email.ts`.
- **Storage** — Supabase Postgres. Wrapped by `interfaces/storage.ts`; mock `mocks/storage.ts`.
- **Maps** — Mapbox. Wrapped by `interfaces/maps.ts`; mock `mocks/maps.ts`.
- **AI** — Anthropic. Wrapped by `interfaces/ai.ts`; mock `mocks/ai.ts`.
- **Auth** — Supabase Auth. Wrapped by `interfaces/auth.ts`; mock `mocks/auth.ts`.

No real SDK calls in this feature; real adapters are stubs that throw `NotConfiguredError`. BLOCKERS.md is updated so the user can fill in credentials in any order.

## Open questions
1. **Postmark vs SendGrid.** SPEC lists "Postmark or SendGrid Inbound" without a decision. This plan uses `POSTMARK_SERVER_TOKEN` as the primary env var name and documents `SENDGRID_API_KEY` as the alternate in BLOCKERS. The real `interfaces/email.ts` stub throws referencing `POSTMARK_SERVER_TOKEN`; if SendGrid wins, a one-line change to the stub + BLOCKERS entry flips it. Flagging so the user can decide before the email real adapter lands.
2. **Route/Stop type reconciliation.** `lib/types.ts` still sketches `RouteStatus` as `"draft" | "assigned" | "active" | "completed"` and `Stop.sequence: number`, while the SQL uses `route_status` = `'pending' | 'active' | 'completed'` and `stops.position: integer`. This feature does not touch route/stop types because no interface method here reads or writes them. The next route-touching feature (likely driver route view or dispatcher route assignment) must reconcile — flagging so it is not forgotten.
3. **Driver type reshape is load-bearing.** Step 2 renames `Driver.userId` → `profileId`, `Driver.name` → `fullName`, adds `vehicleLabel`. Confirmed no callers today via `grep`, but if any unplanned consumer has crept in before the builder starts, this reshape could ripple. Builder should re-grep at step 2 and flag if anything broke.
4. **`resetMocks` via `beforeEach` at global scope.** Hooking every test via `vitest.setup.ts` is the cleanest default, but if any future test needs persistent mock state across its own `it`s within one `describe`, it would need to opt out by re-seeding inside `beforeAll`. This is standard Vitest ergonomics; flagging so the convention is recorded.
