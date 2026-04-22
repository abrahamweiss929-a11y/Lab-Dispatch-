# Plan: Admin UI — CRUD for Drivers, Doctors, and Offices

**Slug:** admin-ui
**SPEC reference:** "Admin CRUD for drivers and doctors" under v1 features IN; "Admin — manages driver accounts, doctor contacts, historical reports (last 30 days)" under Account types. Consumes the seam built by `interface-layer` (storage mock + real stub) and the session/role-protection established by `auth-skeleton` (middleware + `getSession()` + `/admin/*` tree).
**Status:** draft

## Goal
Give a signed-in admin a working, mock-backed UI to list, create, edit, and (soft-)delete the three record types the lab's operations depend on: drivers, doctors, and offices. Every mutation runs through a server action; every read goes through `getServices().storage`; the storage interface gains the minimum set of methods (`getX`, `updateX`, `deleteX`, plus a counts helper) to support the forms; offices auto-generate a unique slug and pickup URL token on create. Real Supabase wiring and an `auth.admin.createUser` integration are explicitly deferred — this feature ends when an admin can CRUD the three resources end-to-end against the mock.

## Out of scope
- Real Supabase storage adapter — `createRealStorageService()` stays a `NotConfiguredError` stub; this feature only consumes the mock (via `getServices()`).
- Real `auth.admin.createUser` integration for driver account creation. The mock fakes the auth user (generates a UUID `profileId`, implicitly assigns mock password `test1234`); a separate future feature wires Supabase Auth Admin.
- Editing admin users themselves. Admins are seeded via `mocks/auth.ts` for v1 and not exposed in this UI.
- Email invites to new drivers (no outbound email in this feature; deferred).
- CSV import / export.
- Historical reports view (per SPEC "In: admin CRUD for drivers and doctors"; "Out: driver performance reports" and "Out: analytics beyond last 30 days"). Admin reports are NOT v1 and not planned here — if the user wants them, spin a separate `admin-reports` feature.
- Pagination, search, or filtering on list pages. Scale is dozens of records per lab; simple tables suffice.
- File upload (driver license photos, office logos, etc).
- Audit log of admin actions.
- Concurrency / optimistic-locking on edit (last-write-wins against the mock is acceptable in v1).
- Component-rendering tests for list/form pages. Page-level React tests require Next-server-component harness and add more scaffolding than value; covered indirectly by server-action unit tests + the manual smoke pass. Documented explicitly so the omission is deliberate.
- E2E / browser tests (no Playwright harness yet; same rationale as `auth-skeleton`).
- Hard-deletion of drivers or offices — they are soft-deleted (`active = false`) because historical pickup requests reference them and the "last 30 days" admin report view (future feature) must still be able to render the historical names. Doctors CAN be hard-deleted (no historical references in v1 schema).
- Per-field validation UX beyond `required` + basic shape checks (email/phone format sniffing is cursory; no libphonenumber/Zod-grade schemas).
- Listing which doctors belong to a soft-deleted office with a special UI treatment. Office list shows `active` flag; doctors filter stays naive for v1.
- Reactivating a soft-deleted driver or office from the list page beyond re-saving the edit form with `active: true` checked.

## Files to create or modify

### New: shared admin chrome
- `/Users/abraham/lab-dispatch/components/AdminLayout.tsx` — server component that wraps children in a two-column layout (`<aside>` sidebar nav + `<main>` content). Nav links: Dashboard (`/admin`), Drivers (`/admin/drivers`), Doctors (`/admin/doctors`), Offices (`/admin/offices`), Log out (`/logout`). Accepts a `title?: string` prop for an `<h1>` above the content and a `children` prop.
- `/Users/abraham/lab-dispatch/components/AdminNavLink.tsx` — client component for sidebar links that highlights the active route via `usePathname()` (simple `startsWith` match on the nav's `href`). Purely presentational; keeps `AdminLayout.tsx` a server component.
- `/Users/abraham/lab-dispatch/lib/require-admin.ts` — small helper exporting `requireAdminSession(): SessionCookieValue`. Calls `getSession()`; if `session === null || session.role !== "admin"`, calls `redirect("/login")` from `next/navigation` (belt-and-suspenders with middleware). Returns the non-null session for page use. Every admin page calls this first.
- `/Users/abraham/lab-dispatch/lib/require-admin.test.ts` — unit test using `vi.mock('next/headers', ...)` and `vi.mock('next/navigation', ...)` to stub cookies + capture redirect. Cases: admin session → returns the session; dispatcher session → redirects; null session → redirects.

### New: slug helper
- `/Users/abraham/lab-dispatch/lib/slugify.ts` — pure helper exporting:
  - `slugify(input: string): string` — ASCII-only kebab-case. Lowercase, replace any run of non-`[a-z0-9]` with a single `-`, trim leading/trailing `-`. Empty input throws `Error("slugify: input is empty")`. Non-ASCII characters (accented letters, emoji, CJK) are stripped during normalization; if the resulting slug is empty after that pass, also throws (so `"!!!"` and `"🙂"` both throw, not silently produce `""`).
  - `ensureUniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string>` — calls `slugify(base)` then probes `isTaken`; if taken, tries `${slug}-2`, `${slug}-3`, ... up to 99. Throws `Error("ensureUniqueSlug: exhausted")` after 99.
- `/Users/abraham/lab-dispatch/lib/slugify.test.ts` — cases: `"Acme Clinic"` → `"acme-clinic"`; `"  Foo   Bar  "` → `"foo-bar"`; `"O'Connor & Sons"` → `"o-connor-sons"`; `"café"` → `"caf"` (accent stripped); `""` throws; `"!!!"` throws; `"🙂"` throws. `ensureUniqueSlug`: when `isTaken` always returns false → base slug; when base slug is taken and `-2` is free → returns `${base}-2`; when `isTaken` returns true for every candidate → throws.

### New: storage interface additions (minimal)
- `/Users/abraham/lab-dispatch/interfaces/storage.ts` — extend `StorageService`:
  - `getOffice(id: string): Promise<Office | null>`
  - `updateOffice(id: string, patch: Partial<Omit<Office, "id">>): Promise<Office>` (throws `"office {id} not found"` if missing)
  - `getDriver(profileId: string): Promise<Driver | null>`
  - `updateDriver(profileId: string, patch: Partial<Omit<Driver, "profileId" | "createdAt">>): Promise<Driver>`
  - `getDoctor(id: string): Promise<Doctor | null>`
  - `updateDoctor(id: string, patch: Partial<Omit<Doctor, "id">>): Promise<Doctor>`
  - `deleteDoctor(id: string): Promise<void>` (hard delete; throws if missing)
  - `countAdminDashboard(): Promise<{ drivers: number; doctors: number; offices: number; pendingPickupRequests: number }>` — returns total driver count (regardless of `active`), total doctor count, total office count (regardless of `active`), and count of pickup requests with `status = "pending"`.

  Note: `createDriver` signature stays `(input: NewDriver): Promise<Driver>` — the mock generates `profileId` internally (UUID via `crypto.randomUUID()`) and passes through `fullName`/`phone`/`vehicleLabel`/`active`. We change `NewDriver` to `Omit<Driver, "profileId" | "createdAt">` to reflect that callers no longer supply the `profileId`. Existing callers of `createDriver` in the codebase: only the storage-mock test, which already supplies `profileId`; update the test to use the new shape (drop `profileId`, keep `fullName`/`phone`/`active`). Real adapter stub's `createDriver` continues to throw `NotConfiguredError`.
  (`NewDriver`'s inclusion of an `email` field: drivers DO have an email in the auth account but NOT on the `Driver` storage record. The form collects email and passes it into `createDriver`; the mock uses it only to seed a mock auth user mapping — see the mock's "Internal mock auth-user map" below. Real Supabase will use it via `auth.admin.createUser`. So the wire shape of `NewDriver` gains an `email: string` that the mock stashes in a separate map and the real stub accepts for future use.)

  Concretely:
  ```ts
  export type NewDriver = Omit<Driver, "profileId" | "createdAt"> & { email: string };
  ```

- `/Users/abraham/lab-dispatch/mocks/storage.ts` — implement the new methods. Add an internal `driverAccounts: Map<string, { email: string; password: "test1234" }>` keyed by `profileId`; `createDriver` generates `profileId` via `crypto.randomUUID()`, writes the driver record, and writes the account map entry (password is hard-coded `"test1234"`, documented in a comment). Export a test-only `getDriverAccount(profileId): { email; password } | undefined` helper so server-action tests can assert the account was created. Also update `createOffice` to auto-generate `pickupUrlToken` via `makeRandomId(12)` if the caller omits it — but server actions always supply it, so this is a defensive convenience only; document it in a comment. (Alternative considered: keep `createOffice` strict and require the caller to supply the token. Rejected because the token is an implementation detail of storage, not a product concern — the office server action already owns generation via `ensureUniqueSlug`, so it passes the token explicitly. Keep `createOffice` strict.) Resolution: `createOffice` stays strict; token is always supplied by the office server action. Remove the "defensive convenience" clause from the implementation.

- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — extend with cases for every new method (see Tests section below). Also update the existing `createDriver` test to the new shape (no `profileId` input; assert one was generated and is a string).

- `/Users/abraham/lab-dispatch/interfaces/index.ts` — re-export any new types (`NewDriver`'s shape changed; it's already re-exported, so this is a no-op in `index.ts`, but if TypeScript flags the change, update the re-exports).

### New: admin dashboard
- `/Users/abraham/lab-dispatch/app/admin/page.tsx` — replace the current placeholder. Async server component. Calls `requireAdminSession()`, then `getServices().storage.countAdminDashboard()`, renders four count cards (Drivers, Doctors, Offices, Pending pickups) wrapped in `<AdminLayout title="Dashboard">`. Each card is a `<Link>` to the matching list page (Pending pickups goes nowhere in this feature — show the count but no link, with a comment noting "links to dispatcher queue; wired when that feature lands"). Plain Tailwind grid.

### New: drivers CRUD
- `/Users/abraham/lab-dispatch/app/admin/drivers/page.tsx` — list. Server component. `requireAdminSession()`, `listDrivers()`, render table with columns: Full name, Email (pulled from the mock-only driver-account map via a helper on storage — see below), Phone, Vehicle label, Active (Yes/No), Created at (ISO). Each row has an Edit link to `/admin/drivers/${profileId}`. Above the table: a "New driver" link to `/admin/drivers/new`. Soft-deleted drivers (`active=false`) show with muted styling but still appear (for v1; a `?hide-inactive=1` toggle is future work, flagged but not implemented).

  Email column sourcing: `Driver` records don't store email; the admin often knows the driver by email. Solution: add a storage method `listDriverAccounts(): Promise<Array<{ profileId: string; email: string }>>` alongside `listDrivers` — the list page fetches both and zips them by `profileId`. In the mock it reads the `driverAccounts` map; real Supabase implementation will `join profiles.email`. Add this method to the interface and mock now to avoid a second round trip later.

- `/Users/abraham/lab-dispatch/app/admin/drivers/new/page.tsx` — form. Client component (`"use client"`) using `useFormState(createDriverAction, { error: null, fieldErrors: {} })`. Fields: `fullName` (required), `email` (required, type=email), `phone` (optional), `vehicleLabel` (optional), `active` (checkbox, default checked). Wrapped in `<AdminLayout title="New driver">` — but `AdminLayout` is a server component and this page is a client component, so the page itself is the server wrapper: make `new/page.tsx` a server component that `requireAdminSession()`s and renders a client child component `NewDriverForm` from `_components/NewDriverForm.tsx`. Same pattern for every form page below.
- `/Users/abraham/lab-dispatch/app/admin/drivers/new/_components/NewDriverForm.tsx` — client component with the actual form + `useFormState` wiring.
- `/Users/abraham/lab-dispatch/app/admin/drivers/[id]/page.tsx` — server component. `requireAdminSession()`, fetch `getDriver(params.id)` (404 page via `notFound()` from `next/navigation` if null), render `<EditDriverForm driver={driver} email={email} />`. Also fetches the driver's email via the account map (same helper the list page uses).
- `/Users/abraham/lab-dispatch/app/admin/drivers/[id]/_components/EditDriverForm.tsx` — client component with pre-filled form + `useFormState(updateDriverAction, ...)`. Includes a "Deactivate" button that toggles `active` to false via the same `updateDriverAction` server action (keeping the form flow simple). Note: email is read-only in the edit form; changing email requires touching auth, which this feature defers.
- `/Users/abraham/lab-dispatch/app/admin/drivers/actions.ts` — server actions:
  - `createDriverAction(prev, formData)` — validates, calls `getServices().storage.createDriver({ fullName, email, phone, vehicleLabel, active })`, on success `revalidatePath("/admin/drivers")` + `redirect("/admin/drivers")`. On failure returns state.
  - `updateDriverAction(profileId, prev, formData)` — bound via `.bind(null, profileId)`; validates; calls `updateDriver(profileId, patch)`; `revalidatePath` + `redirect`.
  - `deactivateDriverAction(profileId)` — bound, takes no form input; `updateDriver(profileId, { active: false })`; `revalidatePath` + `redirect("/admin/drivers")`. Not a form; invoked via a button in the list row (inside a `<form action={...}>` with no visible inputs).
- `/Users/abraham/lab-dispatch/app/admin/drivers/actions.test.ts` — unit tests exercising each action against the mock storage directly. Happy path + validation error for create, update, deactivate. (Details in Tests section.)

### New: doctors CRUD
- `/Users/abraham/lab-dispatch/app/admin/doctors/page.tsx` — list. Columns: Doctor name, Office (resolved by joining `listOffices()` into a `Map<officeId, Office>`), Phone, Email. Rows sorted by `office.name`, then doctor `name` (alphabetic within each office group). Each row has an Edit link and a Delete button (hard delete, guarded by `confirm()` on the client — but server actions don't run client JS, so the Delete control is a `<form action={deleteDoctorAction.bind(null, doctor.id)}><button>Delete</button></form>`; for a confirmation, use a small client child `DeleteDoctorButton` that wraps the form with an `onSubmit` confirm). Above table: "New doctor" link.
- `/Users/abraham/lab-dispatch/app/admin/doctors/_components/DeleteDoctorButton.tsx` — tiny client component that wraps the server-action `<form>` with a click-time `confirm("Delete Dr. {name}? This cannot be undone.")`.
- `/Users/abraham/lab-dispatch/app/admin/doctors/new/page.tsx` — server wrapper + client `NewDoctorForm`. Form fields: `officeId` (required, populated from `listOffices()` dropdown — `<select>` with the option text as `office.name` and value as `office.id`; empty default option reads "Choose an office"), `name` (required), `phone` (optional), `email` (optional).
- `/Users/abraham/lab-dispatch/app/admin/doctors/new/_components/NewDoctorForm.tsx` — client form, receives `offices: Array<{ id: string; name: string }>` as a prop.
- `/Users/abraham/lab-dispatch/app/admin/doctors/[id]/page.tsx` — server wrapper + client `EditDoctorForm`. Fetches `getDoctor(id)` (`notFound()` if null) and `listOffices()` for the dropdown.
- `/Users/abraham/lab-dispatch/app/admin/doctors/[id]/_components/EditDoctorForm.tsx` — client form.
- `/Users/abraham/lab-dispatch/app/admin/doctors/actions.ts`:
  - `createDoctorAction(prev, formData)` — validates `officeId` exists via `getOffice()`; calls `createDoctor({ officeId, name, phone, email })`; `revalidatePath("/admin/doctors")` + `redirect`.
  - `updateDoctorAction(id, prev, formData)` — bound; validates office exists if `officeId` changed; calls `updateDoctor(id, patch)`; `revalidatePath` + `redirect`.
  - `deleteDoctorAction(id)` — bound; calls `deleteDoctor(id)`; `revalidatePath("/admin/doctors")` + `redirect("/admin/doctors")`.
- `/Users/abraham/lab-dispatch/app/admin/doctors/actions.test.ts` — unit tests (happy + error paths).

### New: offices CRUD
- `/Users/abraham/lab-dispatch/app/admin/offices/page.tsx` — list. Columns: Name, Slug, Phone, Email, City/State (`${city}, ${state}`), Active (Yes/No). Edit link per row. Above table: "New office" link. Soft-deleted offices shown muted.
  - Note: `Office` in `lib/types.ts` does NOT currently have an `active` field. This feature adds `active: boolean` to `Office` and the `offices` row in `supabase/schema.sql` (defaulting to `true`). See "Modifications" below. List page shows the active flag once it's added.
- `/Users/abraham/lab-dispatch/app/admin/offices/new/page.tsx` — server wrapper + client `NewOfficeForm`. Fields: `name` (required), `slug` (optional — auto-generated from `name` if empty), `phone` (optional), `email` (optional), `street` (required), `city` (required), `state` (required, 2-letter US state code, `<input maxLength={2}>` uppercased on submit), `zip` (required, 5-digit), `active` (checkbox, default checked). `pickupUrlToken` is NOT a form field — the action generates it.
- `/Users/abraham/lab-dispatch/app/admin/offices/new/_components/NewOfficeForm.tsx` — client form.
- `/Users/abraham/lab-dispatch/app/admin/offices/[id]/page.tsx` — server wrapper + client `EditOfficeForm`. Shows the `pickupUrlToken` read-only with a copy-to-clipboard button (client-side `navigator.clipboard.writeText`) and a display of the full pickup URL (`/pickup/{slug}-{pickupUrlToken}`). Token is NOT editable. Slug IS editable but uniqueness is re-checked on save.
- `/Users/abraham/lab-dispatch/app/admin/offices/[id]/_components/EditOfficeForm.tsx` — client form.
- `/Users/abraham/lab-dispatch/app/admin/offices/actions.ts`:
  - `createOfficeAction(prev, formData)` — validates required fields; computes `slug`: if provided, `slugify(provided)`; else `slugify(name)`; runs `ensureUniqueSlug(base, isTakenAgainstExistingOffices)`. `isTakenAgainstExistingOffices` fetches `listOffices()` once and closes over the resulting slug set (avoids a per-probe round trip against a real backend; fine for v1 scale). Generates `pickupUrlToken = makeRandomId(12)`. Calls `createOffice({ name, slug, pickupUrlToken, address: { street, city, state, zip }, phone, email, active })`. `revalidatePath("/admin/offices")` + `redirect("/admin/offices")`.
  - `updateOfficeAction(id, prev, formData)` — bound; re-computes slug if it changed; re-checks uniqueness excluding the current office's current slug; calls `updateOffice(id, patch)`; `revalidatePath` + `redirect`.
  - `deactivateOfficeAction(id)` — bound; `updateOffice(id, { active: false })`; `revalidatePath`; does NOT redirect (keeps admin on list page via `revalidatePath` only — same treatment as `deactivateDriverAction` for consistency; adjust to also `redirect("/admin/offices")` if the row action isn't on the list page — spoiler: it is, so `revalidatePath` alone suffices).
- `/Users/abraham/lab-dispatch/app/admin/offices/actions.test.ts` — unit tests.

### Modifications
- `/Users/abraham/lab-dispatch/lib/types.ts` — add `active: boolean` to `Office`. Rationale: soft-delete requires a tombstone column, which `Driver` already has but `Office` lacks. Flagging so the builder does not forget to update any existing `Office` literal in tests/mocks to include `active: true`. Grep after the edit: `grep -rn "createOffice\|Office = {" app lib interfaces mocks supabase` to confirm all sites are updated.
- `/Users/abraham/lab-dispatch/supabase/schema.sql` — add `active boolean not null default true` to the `offices` table. Note: this feature does not run a live DB migration (real Supabase is still stubbed), but the schema file is the source of truth and must match `lib/types.ts`. Confirm by re-running whatever test covers schema consistency (see `lib/schema.test.ts`).
- `/Users/abraham/lab-dispatch/lib/schema.test.ts` — if it asserts column presence, add the new `active` column assertion. If it merely parses the SQL for syntactic correctness, no edit needed; read the file during step 1 and decide.
- `/Users/abraham/lab-dispatch/app/admin/page.tsx` — replace the placeholder entirely (listed above under "New: admin dashboard"; it's a rewrite, not an addition, but counted as a modification since the file already exists).
- `/Users/abraham/lab-dispatch/BUILD_LOG.md` — append a dated entry summarizing this feature's shipment.
- `/Users/abraham/lab-dispatch/BLOCKERS.md` — no new entries. The existing `[supabase]` entry already covers `createDriver` needing `auth.admin.createUser` + RLS — but this feature's exposure of that gap is worth a one-line addendum under that entry's "Workaround in place": "Admin driver-create flow generates a UUID `profileId` in `mocks/storage.ts` and stores a mock-only email+password (`test1234`) in a side map; real adapter must call `supabase.auth.admin.createUser` + create matching `profiles` + `drivers` rows in a transaction." Add exactly this sentence; do not restructure the entry.

## Interfaces / contracts

### `interfaces/storage.ts` additions
```ts
// NewDriver shape CHANGES: email is now required, profileId is removed.
export type NewDriver = Omit<Driver, "profileId" | "createdAt"> & { email: string };

export interface StorageService {
  // ...existing nine methods unchanged except NewDriver's input shape...

  getOffice(id: string): Promise<Office | null>;
  updateOffice(
    id: string,
    patch: Partial<Omit<Office, "id">>,
  ): Promise<Office>;

  getDriver(profileId: string): Promise<Driver | null>;
  updateDriver(
    profileId: string,
    patch: Partial<Omit<Driver, "profileId" | "createdAt">>,
  ): Promise<Driver>;
  listDriverAccounts(): Promise<Array<{ profileId: string; email: string }>>;

  getDoctor(id: string): Promise<Doctor | null>;
  updateDoctor(
    id: string,
    patch: Partial<Omit<Doctor, "id">>,
  ): Promise<Doctor>;
  deleteDoctor(id: string): Promise<void>;

  countAdminDashboard(): Promise<{
    drivers: number;
    doctors: number;
    offices: number;
    pendingPickupRequests: number;
  }>;
}
```
- `updateOffice`/`updateDriver`/`updateDoctor` throw `Error("<type> {id} not found")` when the id is missing. Patches use shallow `Object.assign`; `address` on `updateOffice` is a full replace (not deep-merge) for simplicity — document in the method's JSDoc.
- `listDriverAccounts()` is mock-only in spirit: it reads an internal map populated by `createDriver`. Real Supabase implementation will query `profiles.email` joined on `drivers.profile_id`. Returning the same shape in both worlds is the point.
- `countAdminDashboard()` returns totals independent of `active` for drivers/offices (admins want to see all records, active or not, in the count). Pending pickups uses `status = "pending"` exactly.

### `lib/slugify.ts`
```ts
export function slugify(input: string): string;
export function ensureUniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string>;
```

### `lib/require-admin.ts`
```ts
import type { SessionCookieValue } from "@/lib/session";
export function requireAdminSession(): SessionCookieValue; // may throw via redirect()
```

### Server action form-state shape
Standardize across all six create/update actions:
```ts
export interface AdminFormState {
  error: string | null;                         // top-level error banner
  fieldErrors: Partial<Record<string, string>>; // per-field inline errors
}
```
All actions export `INITIAL_ADMIN_FORM_STATE: AdminFormState = { error: null, fieldErrors: {} }`.

### Routes
No new HTTP API routes. All admin pages are Next App Router server components; mutations are server actions (not API routes).

## Implementation steps

1. **Read existing schema+types.** Read `/Users/abraham/lab-dispatch/supabase/schema.sql` and `/Users/abraham/lab-dispatch/lib/schema.test.ts` to confirm the exact shape and testing approach. Adjust step 2 (adding `Office.active`) accordingly. No code changes yet.

2. **Add `active` to `Office`.** Edit `/Users/abraham/lab-dispatch/lib/types.ts`: add `active: boolean` to the `Office` interface. Edit `/Users/abraham/lab-dispatch/supabase/schema.sql`: add `active boolean not null default true` to the `offices` table definition. If `lib/schema.test.ts` asserts columns, add the `active` assertion. Grep for all existing `Office` literals: `grep -rn "createOffice\|slug:" app lib interfaces mocks supabase tests` — update every literal to include `active: true`. Run `npm run typecheck` — must pass.

3. **Slugify helper + tests.** Create `/Users/abraham/lab-dispatch/lib/slugify.ts` and `/Users/abraham/lab-dispatch/lib/slugify.test.ts` per the contract. Implementation: use `String.prototype.normalize("NFKD")` to split accents, then `.replace(/[\u0300-\u036f]/g, "")` to strip combining marks, then lowercase + `replace(/[^a-z0-9]+/g, "-")` + trim. `ensureUniqueSlug` loops from 2 to 99 suffix. Run `npm run test -- slugify`; confirm pass.

4. **Admin session helper + test.** Create `/Users/abraham/lab-dispatch/lib/require-admin.ts` and `/Users/abraham/lab-dispatch/lib/require-admin.test.ts`. The test uses `vi.mock('next/navigation', () => ({ redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }) }))` so the helper's `redirect()` call is observable (Next's real `redirect` throws; mocking it to throw a tagged error lets us assert both the redirect target and the fact that the function didn't return). Mock `next/headers` cookies to return each of: a valid admin session, a valid dispatcher session, no cookie.

5. **Extend storage interface.** Edit `/Users/abraham/lab-dispatch/interfaces/storage.ts`:
   - Change `NewDriver` to `Omit<Driver, "profileId" | "createdAt"> & { email: string }`.
   - Add the nine new methods (getOffice, updateOffice, getDriver, updateDriver, listDriverAccounts, getDoctor, updateDoctor, deleteDoctor, countAdminDashboard) to `StorageService`.
   - Add stubs for each to `createRealStorageService()` (each throws `NotConfiguredError` with `envVar: "NEXT_PUBLIC_SUPABASE_URL"`).
   Run `npm run typecheck` — it WILL fail (mock doesn't implement new methods yet). Move on to the next step.

6. **Extend storage mock.** Edit `/Users/abraham/lab-dispatch/mocks/storage.ts`:
   - Add `driverAccounts: Map<string, { email: string; password: string }>` to internal state.
   - Rewrite `createDriver`:
     ```ts
     async createDriver(input: NewDriver): Promise<Driver> {
       const profileId = globalThis.crypto.randomUUID();
       const { email, ...rest } = input;
       const driver: Driver = { ...rest, profileId, createdAt: nowIso() };
       state.drivers.set(profileId, driver);
       state.driverAccounts.set(profileId, { email, password: "test1234" });
       return driver;
     }
     ```
     (The hard-coded `"test1234"` is a mock-only artifact; add a top-of-file comment pointing at BLOCKERS.md [supabase].)
   - Implement `getDriver(profileId)` → `state.drivers.get(profileId) ?? null`.
   - Implement `updateDriver(profileId, patch)` — throw if missing; store and return a new object (`{ ...existing, ...patch }`).
   - Implement `listDriverAccounts()` — `Array.from(state.driverAccounts.entries()).map(([profileId, { email }]) => ({ profileId, email }))` sorted by `profileId` for determinism.
   - Implement `getOffice(id)`, `updateOffice(id, patch)` (same pattern).
   - Implement `getDoctor(id)`, `updateDoctor(id, patch)`, `deleteDoctor(id)` (hard delete from map; throw if missing).
   - Implement `countAdminDashboard()` — returns `{ drivers: state.drivers.size, doctors: state.doctors.size, offices: state.offices.size, pendingPickupRequests: [...state.pickupRequests.values()].filter(r => r.status === "pending").length }`.
   - Export `getDriverAccount(profileId)` as a test helper (not on the interface).
   - Update `resetStorageMock()` to clear `driverAccounts`.

7. **Extend storage mock tests.** Edit `/Users/abraham/lab-dispatch/mocks/storage.test.ts`:
   - Update the existing "creates and lists drivers" test to use the new `NewDriver` shape (no `profileId` input; supply `email: "alice@test"` + the rest). Assert `created.profileId` is a non-empty string (UUID-shaped).
   - Add: `createDriver also seeds a mock driver account` — after create, `listDriverAccounts()` returns one entry with the matching `profileId` and email.
   - Add: `getDriver / getDoctor / getOffice return null when id is missing`.
   - Add: `updateDriver / updateDoctor / updateOffice apply patches`, `reject missing ids`, `preserve fields not in the patch`, `preserve createdAt on driver update`.
   - Add: `deleteDoctor removes the row and subsequent getDoctor returns null`; `deleteDoctor throws on missing id`.
   - Add: `countAdminDashboard sums correctly across mixed state` (seed 2 drivers, 3 doctors, 1 office with `active: false` plus 1 with `active: true`, 2 pending pickups, 1 completed → counts are `{ drivers: 2, doctors: 3, offices: 2, pendingPickupRequests: 2 }`).
   Run `npm run test -- mocks/storage` and confirm pass.

8. **Admin layout + nav.** Create `/Users/abraham/lab-dispatch/components/AdminNavLink.tsx` (client) and `/Users/abraham/lab-dispatch/components/AdminLayout.tsx` (server, composes `AdminNavLink` for each link). Sidebar Tailwind: `aside` fixed-width 200px, `main` flex-1. Nav renders `AdminNavLink` for each of the four routes plus a plain `<a href="/logout">Log out</a>` at the bottom. `AdminLayout` accepts `{ title?: string; children: ReactNode }`, renders `title` as `<h1 className="text-2xl font-bold mb-6">` above children.

9. **Admin dashboard.** Rewrite `/Users/abraham/lab-dispatch/app/admin/page.tsx`: async server component, calls `requireAdminSession()`, then `getServices().storage.countAdminDashboard()`, renders four cards in a grid inside `<AdminLayout title="Dashboard">`. Cards: each shows a label + big number; the three resource cards wrap in `<Link>` to the list page; the pending-pickups card is a `<div>` with a code comment "links to dispatcher queue; wired when that feature lands".

10. **Drivers list.** Create `/Users/abraham/lab-dispatch/app/admin/drivers/page.tsx` — server component. `requireAdminSession()`, fetch `listDrivers()` and `listDriverAccounts()` in parallel (`Promise.all`), zip them by `profileId` into a rendered array. Render table + "New driver" link inside `<AdminLayout title="Drivers">`. Soft-deleted rows get `className="opacity-50"`. Include a per-row `<form action={deactivateDriverAction.bind(null, driver.profileId)}>` submit button labeled "Deactivate" — visible only when `driver.active`.

11. **Drivers create.** Create:
    - `/Users/abraham/lab-dispatch/app/admin/drivers/new/page.tsx` (server wrapper).
    - `/Users/abraham/lab-dispatch/app/admin/drivers/new/_components/NewDriverForm.tsx` (client, uses `useFormState(createDriverAction, INITIAL_ADMIN_FORM_STATE)`).
    - `/Users/abraham/lab-dispatch/app/admin/drivers/actions.ts` with `createDriverAction`. Validation:
      - `fullName` non-empty → else `fieldErrors.fullName = "Required"`.
      - `email` non-empty AND matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` → else `fieldErrors.email = "Enter a valid email"`.
      - `phone`: if non-empty, strip whitespace and require length ≥ 7 (loose — SPEC US-only but we don't lint format strictly) → else `fieldErrors.phone = "Phone looks too short"`.
      - `vehicleLabel`: no validation.
      - `active`: checkbox → `formData.get("active") === "on"`.
      If any `fieldErrors` present, return state (no mutation). Else call `createDriver`, `revalidatePath("/admin/drivers")`, `redirect("/admin/drivers")`.

12. **Drivers edit.** Create `/Users/abraham/lab-dispatch/app/admin/drivers/[id]/page.tsx` (server wrapper, fetches `getDriver` + email from `listDriverAccounts`; `notFound()` if driver null) and `EditDriverForm.tsx` (client). Add `updateDriverAction(profileId, prev, formData)` and `deactivateDriverAction(profileId)` to `actions.ts`. The edit form reuses the same field list minus email (read-only display).

13. **Drivers actions tests.** Create `/Users/abraham/lab-dispatch/app/admin/drivers/actions.test.ts`. Mock `next/navigation`'s `redirect` and `next/cache`'s `revalidatePath` (both via `vi.mock`) so the actions don't blow up. Each action test builds a `FormData` via `new FormData()`, calls the action, and asserts: (a) the mock storage was mutated as expected, (b) on success `redirect` was called with the right path, (c) on validation error the returned state contains the expected `fieldErrors`. Cover: happy create, create-with-invalid-email, happy update, update-on-missing-id returns an error state, deactivate sets active=false.

14. **Doctors list.** Create `/Users/abraham/lab-dispatch/app/admin/doctors/page.tsx` (server). Fetches `listDoctors()` and `listOffices()` in parallel; builds a `Map<officeId, Office>`. Renders table sorted by office name then doctor name. Each row: Edit link, `<DeleteDoctorButton doctorId={doc.id} doctorName={doc.name} />`. Above table: "New doctor" link.

15. **Doctors delete button (client).** Create `/Users/abraham/lab-dispatch/app/admin/doctors/_components/DeleteDoctorButton.tsx` — client component accepting `{ doctorId: string; doctorName: string }`, renders a `<form action={deleteDoctorActionBound}>` where `deleteDoctorActionBound` is `deleteDoctorAction.bind(null, doctorId)`. Wait — server actions imported into a client component: you cannot bind on the client. Correct pattern: the client component imports the action (which is a reference to the server function), wraps it in an `onSubmit` that calls `event.preventDefault()`, then `if (!confirm(...)) return;`, then `formRef.current.submit()`. Simpler: use an inline form + a submit handler on the button that runs `confirm()` first. Document the exact pattern inline in the file.

16. **Doctors create + edit + actions.** Create `/new/page.tsx`, `/new/_components/NewDoctorForm.tsx`, `/[id]/page.tsx`, `/[id]/_components/EditDoctorForm.tsx`, and `/app/admin/doctors/actions.ts`. Validation mirrors drivers. `createDoctorAction` additionally verifies `getOffice(officeId)` is non-null before calling `createDoctor` — else `fieldErrors.officeId = "Office not found"`. `updateDoctorAction` same check on officeId changes. `deleteDoctorAction` is straightforward.

17. **Doctors actions tests.** Create `/Users/abraham/lab-dispatch/app/admin/doctors/actions.test.ts` mirroring drivers. Add a specific test: `createDoctorAction rejects an unknown officeId` — seed only one office, submit a FormData with a different `officeId`, assert `fieldErrors.officeId` is set and `listDoctors()` is unchanged.

18. **Offices list.** Create `/Users/abraham/lab-dispatch/app/admin/offices/page.tsx` (server). Fetches `listOffices()`. Renders table. Include per-row Edit link; soft-deleted rows are muted. Above table: "New office" link.

19. **Offices create.** Create `/new/page.tsx` + `/new/_components/NewOfficeForm.tsx` + `/Users/abraham/lab-dispatch/app/admin/offices/actions.ts`. `createOfficeAction`:
    - Validate all required fields (`name`, `street`, `city`, `state` (2-char), `zip` (5-digit)).
    - Compute slug: `const base = formData.get("slug") ? slugify(String(formData.get("slug"))) : slugify(String(formData.get("name")));`.
    - Pre-fetch `listOffices()`, build a `Set<string>` of existing slugs.
    - `const slug = await ensureUniqueSlug(base, async (candidate) => existing.has(candidate));`.
    - Generate `pickupUrlToken = makeRandomId(12)`.
    - `createOffice({ name, slug, pickupUrlToken, address: { street, city, state: state.toUpperCase(), zip }, phone: ..., email: ..., active: true })`.
    - `revalidatePath("/admin/offices")` + `redirect("/admin/offices")`.
    Error paths: if `slugify` throws (empty / ASCII-empty input), catch and return `{ error: "Could not derive a URL slug from the name; please enter a slug manually." }`; if `ensureUniqueSlug` exhausts, return `{ error: "Slug collision after 99 attempts; pick a different slug." }`.

20. **Offices edit.** `/[id]/page.tsx` + `/[id]/_components/EditOfficeForm.tsx`. Form pre-fills all fields. `pickupUrlToken` is rendered read-only with a copy button (client: `navigator.clipboard.writeText`); the full pickup URL is also rendered as text (`/pickup/${slug}-${pickupUrlToken}`) so the admin can share it. `updateOfficeAction(id, prev, formData)`:
    - If slug changed, run `ensureUniqueSlug` against `listOffices()` minus the current office's current row (so it doesn't flag as colliding with itself).
    - Build patch, call `updateOffice`, `revalidatePath` + `redirect`.
    Also implement `deactivateOfficeAction(id)` — sets `active: false`, `revalidatePath("/admin/offices")`. No redirect (stay on the list page; the row action is on the list page).

21. **Offices actions tests.** Create `/Users/abraham/lab-dispatch/app/admin/offices/actions.test.ts`. Cases:
    - Happy create: FormData with valid fields, assert office was created with correctly-slugified slug + 12-char token.
    - Slug collision: seed an existing office with slug `"acme-clinic"`, submit a new office also named `"Acme Clinic"` — resulting slug is `"acme-clinic-2"`.
    - Missing required field → fieldError.
    - Slug derivation failure (name = `"🙂"` and no explicit slug) → state.error set.
    - Update: change slug to a taken one → fieldError on slug; change slug to the same existing slug → passes (not treated as collision with self).
    - Deactivate: `active` flips to false.

22. **Wire dashboard counts.** Verify the dashboard page renders the four counts from `countAdminDashboard()`. No new file.

23. **BLOCKERS.md + BUILD_LOG.md.** Append the one-sentence addendum to the `[supabase]` entry's "Workaround in place" line (see Modifications). Append a dated BUILD_LOG entry summarizing: admin dashboard, drivers/doctors/offices CRUD, soft-delete policy, slugify helper, storage interface additions, mock-only `driverAccounts` map, explicit deferrals (real auth admin create, reports).

24. **Verification gate.** Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. All four must pass. Manual smoke (documented, not gated): `npm run dev`, sign in as `admin@test` / `test1234`, navigate to `/admin` (dashboard), `/admin/drivers` (create one, edit, deactivate), `/admin/offices` (create one — verify generated slug + token), `/admin/doctors` (create one linking to that office, edit, delete). Note results in BUILD_LOG entry.

## Tests to write

- `/Users/abraham/lab-dispatch/lib/slugify.test.ts` — cases listed in the "New: slug helper" section: basic kebab-case, whitespace trimming, punctuation folding, accent stripping, ASCII-only result, empty/all-punct/emoji inputs throw; `ensureUniqueSlug` happy, collision-with-suffix, exhaustion.
- `/Users/abraham/lab-dispatch/lib/require-admin.test.ts` — admin session → returns session; dispatcher session → redirect to `/login`; null session → redirect to `/login`. Mocks `next/headers` and `next/navigation`.
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` (extended) — all new methods + updated driver-create shape. Specific cases listed in step 7.
- `/Users/abraham/lab-dispatch/app/admin/drivers/actions.test.ts` — happy create; create with invalid email → fieldError; happy update; update on missing id → state.error set (action catches the storage throw and returns it); deactivate sets `active=false`. Mocks `next/navigation.redirect` and `next/cache.revalidatePath`.
- `/Users/abraham/lab-dispatch/app/admin/doctors/actions.test.ts` — happy create; create with unknown officeId → fieldError; happy update; delete removes the doctor.
- `/Users/abraham/lab-dispatch/app/admin/offices/actions.test.ts` — happy create (assert slug derivation + token length); slug collision uses `-2` suffix; missing required field → fieldError; unslug-able name → state.error; update rename to a taken slug → fieldError; update rename to same slug → passes; deactivate flips `active`.

### Explicitly NOT written in this feature
- **No component-rendering or page-integration tests for list/form pages.** Setting up a Next server-component + React 19 form-state test harness adds scaffolding (either `@testing-library/react` + `vitest`'s JSDOM + manual provider wiring, or an E2E runner). The load-bearing logic sits in server actions and storage mock methods, both of which ARE unit-tested. Form-field rendering, error display, and client-form binding are shallow glue covered by manual smoke. Revisit when E2E infra lands.
- **No tests of `AdminLayout` or `AdminNavLink`.** Purely presentational; not worth the harness cost at this stage.

## External services touched

- **Storage** — wrapped by `interfaces/storage.ts`; this feature extends the interface and the mock (`mocks/storage.ts`). Real adapter (`createRealStorageService()`) gets corresponding stubs that throw `NotConfiguredError`; no live Supabase calls.
- **Auth** — **read-only**: pages call `getSession()` via `requireAdminSession`. No new `auth.*` calls are added. Driver account creation in this feature is simulated inside the storage mock's `driverAccounts` side map; real `supabase.auth.admin.createUser` is deferred to a future feature.

No new SMS, email, Mapbox, or Anthropic calls introduced.

## Open questions

1. **`Office.active` schema addition.** Adding a new column to `supabase/schema.sql` for a soft-delete flag is a real schema change. This feature ships it because soft-delete is load-bearing for admin UX and the schema file is the source of truth (the table isn't live yet). If this conflicts with any in-flight migration planning, raise before building. Defaulting to `true` means existing seeded offices (if any) remain active without a data migration.

2. **Driver email storage location.** In the mock, `driverAccounts` is a side map on the storage mock because `Driver` records don't carry email (the real schema puts email on `profiles`). This works for v1 but bakes a "storage mock knows about auth accounts" coupling that will not map cleanly once Supabase Auth is real. Two alternatives were considered and rejected for this feature: (a) add `email?: string` directly to `Driver`, which would mislead the real adapter into thinking email is on `drivers` not `profiles`; (b) split into a separate `auth-profiles` interface now, which is more surface than this feature needs. The builder should re-evaluate when the Supabase Auth real adapter lands. Flagging so it isn't forgotten.

3. **`confirm()`-based delete UX.** Using `window.confirm()` inside a client component is a low-effort v1 UX. If the user prefers a proper modal, that's a separate UI polish pass; this feature punts. The user may want to pick a UI library (e.g. Radix Dialog) before more admin-adjacent features land, which would inform retro-fitting these confirms.

4. **Address geocoding on office create.** `Office.lat` / `Office.lng` are optional today. This feature doesn't call the maps service on create — offices are stored without coordinates. When the dispatcher route-planning feature needs them, it can backfill via `getServices().maps.geocode`, or this feature can be revisited to geocode-on-create. Deferring until a real caller needs it.

5. **Admin can edit admin users?** Explicitly out of scope here. Admin users are seeded in `mocks/auth.ts` only. If a lab needs a second admin in v1, they must edit the seed. The BLOCKERS entry for supabase already notes Supabase Auth Admin is needed; add to that list if multi-admin proves necessary pre-launch.

6. **Does soft-deleting an office cascade to doctors?** SPEC does not address this. This feature's answer: no cascade. A soft-deleted office's doctors remain in the doctors list, and the office name still renders (the doctors list joins on `listOffices()` which returns soft-deleted offices too). If the user prefers cascading behavior, flag before building. Recommendation: defer to admin reports feature when reporting-time filtering is easier.
