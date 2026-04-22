# Plan: Per-office public pickup request form

**Slug:** pickup-form
**SPEC reference:** "Pickup request channels (no doctor logins)" → "Per-office web link". Plus "Confirmation flow" (auto-reply with ETA).
**Status:** draft

## Goal

Give each doctor's office a unique, bookmarkable public URL (`/pickup/{slug}-{token}`) that renders a pre-identified pickup request form with no login required. A successful submission creates a pending `PickupRequest` in storage, shows the office a friendly confirmation with an ETA placeholder, and fires an auto-confirmation email when an office email is on file.

## Out of scope

- Doctor identity within an office (SPEC explicitly says "no doctor logins"; the office itself is the identifier).
- File attachments on the request.
- Dispatcher follow-up prompts / clarifying questions.
- SMS and email intake channels (those are a separate feature — AI parsing pipeline).
- Real ETA computation from routes/Mapbox. v1 returns a hardcoded "within about 2 hours" string from `lib/eta.ts` and flags it as a placeholder until dispatcher route planning / Mapbox ETA lands.
- Persistent / cross-process rate limiting (Redis, edge KV). v1 is in-memory per server instance.
- Token rotation / revocation UI (admin form already surfaces the token; rotation is a later feature).
- SMS heads-up "~10 minutes away" notification (separate feature wired to the driver check-in flow).

## Files to create or modify

### New — library helpers

- `/Users/abraham/lab-dispatch/lib/parse-slug-token.ts` — pure function `parseSlugToken(slugToken: string): { slug: string; token: string } | null`. Splits on the LAST `-`. Validates token matches `/^[a-z0-9]{12}$/` (shape produced by `makeRandomId(12)`). Returns null on any shape failure.
- `/Users/abraham/lab-dispatch/lib/parse-slug-token.test.ts` — unit tests.
- `/Users/abraham/lab-dispatch/lib/eta.ts` — pure function `estimateEtaText(): string` returning `"within about 2 hours"`. JSDoc flags this as a v1 placeholder until dispatcher route planning feeds real ETAs.
- `/Users/abraham/lab-dispatch/lib/eta.test.ts` — unit test that pins the literal string so a downstream swap is a deliberate test update.
- `/Users/abraham/lab-dispatch/lib/rate-limit.ts` — exports `TokenBucket` class with `constructor({ capacity, refillPerMs })` and `tryConsume(key: string): boolean`. Pure (takes `now: number` optional, defaulting to `Date.now()`, so tests can pass a deterministic clock). Module-scope `Map<string, { tokens: number; updatedAt: number }>` keyed by `key`. Documented as in-memory, resets on server restart — good enough for v1.
- `/Users/abraham/lab-dispatch/lib/rate-limit.test.ts` — unit tests.

### New — route + action

- `/Users/abraham/lab-dispatch/app/pickup/[slugToken]/page.tsx` — server component. Parses `slugToken` via `parseSlugToken`; on null → `notFound()`. Looks up office via `getServices().storage.findOfficeBySlugToken(slug, token)`; on null or `active === false` → `notFound()`. Renders the `PickupRequestForm` client component with office summary props.
- `/Users/abraham/lab-dispatch/app/pickup/[slugToken]/_components/PickupRequestForm.tsx` — client component (`"use client"`). Uses `useFormState(submitPickupRequestAction, INITIAL_STATE)`. Renders fields, errors, and either the form or the success card based on `state.status`.
- `/Users/abraham/lab-dispatch/app/pickup/[slugToken]/actions.ts` — `"use server"`. Exports `submitPickupRequestAction(prevState, formData)`. No auth. Rate-limits per slugToken. Validates, looks up office, creates request, sends confirmation email (best-effort), returns result state.
- `/Users/abraham/lab-dispatch/app/pickup/[slugToken]/actions.test.ts` — unit tests against mocks (happy + validation + rate-limit + missing-office).
- `/Users/abraham/lab-dispatch/app/pickup/not-found.tsx` — custom not-found page for the `/pickup` segment: "Unknown pickup link. Check with the lab for a new one."

### Modified — interface + mock

- `/Users/abraham/lab-dispatch/interfaces/storage.ts` — add method `findOfficeBySlugToken(slug: string, token: string): Promise<Office | null>` to `StorageService`, plus a `notConfigured()` stub in `createRealStorageService()`.
- `/Users/abraham/lab-dispatch/mocks/storage.ts` — implement `findOfficeBySlugToken` with a full-scan lookup. Returns null for inactive offices (policy: public form must never resolve an inactive office). Add note in JSDoc.
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — extend with a `findOfficeBySlugToken` describe block covering happy / wrong token / wrong slug / inactive.

### Verification only (no change)

- `/Users/abraham/lab-dispatch/lib/auth-rules.ts` — `PUBLIC_PATH_PREFIXES` already contains `"/pickup/"`. Plan step verifies this; no code change. If it is ever removed, add a regression test.

## Interfaces / contracts

### `lib/parse-slug-token.ts`

```ts
export interface ParsedSlugToken {
  slug: string;
  token: string;
}
export function parseSlugToken(slugToken: string): ParsedSlugToken | null;
```

Rules:
- Input must contain at least one `-`.
- Split on the LAST `-`.
- `token` must match `/^[a-z0-9]{12}$/` (the exact shape from `makeRandomId(12)`).
- `slug` (everything before the last `-`) must be non-empty and match `/^[a-z0-9-]+$/` (matches the slugify policy in `lib/slugify.ts`). No leading/trailing dash, no consecutive dashes — but we only sanity-check pattern; canonical normalization lives in `slugify`.
- Any failure → `null`.

### `lib/eta.ts`

```ts
/**
 * v1 placeholder. Returns a human-readable ETA fragment used by the
 * public pickup-request confirmation. Real ETAs will come from
 * dispatcher route planning (Mapbox) once that feature lands.
 */
export function estimateEtaText(): string;
```

### `lib/rate-limit.ts`

```ts
export interface TokenBucketOptions {
  /** Max tokens per key. */
  capacity: number;
  /** Tokens added per millisecond (fractional ok). */
  refillPerMs: number;
}

export class TokenBucket {
  constructor(opts: TokenBucketOptions);
  /** Returns true if a token was consumed; false if the bucket was empty. */
  tryConsume(key: string, now?: number): boolean;
  /** Test helper. */
  reset(): void;
}
```

Module-scope singleton used by the action:

```ts
// 10 requests per 5 minutes per slugToken.
export const pickupFormBucket = new TokenBucket({
  capacity: 10,
  refillPerMs: 10 / (5 * 60 * 1000),
});
```

### `StorageService.findOfficeBySlugToken`

```ts
/**
 * Returns the office whose (slug, pickupUrlToken) pair matches, and only
 * when `active === true`. Inactive matches resolve to null — the public
 * pickup form treats them as unknown. Real Supabase adapter will back
 * this with an index on (slug, pickup_url_token) for O(1) lookup; the
 * mock full-scans.
 */
findOfficeBySlugToken(slug: string, token: string): Promise<Office | null>;
```

### Server action contract

```ts
export type PickupFormState =
  | { status: "idle"; error: null; fieldErrors: {} }
  | {
      status: "error";
      error: string | null;            // banner
      fieldErrors: Partial<Record<"notes" | "urgency" | "sampleCount", string>>;
    }
  | { status: "ok"; requestId: string; etaText: string };

export const INITIAL_PICKUP_FORM_STATE: PickupFormState;

export async function submitPickupRequestAction(
  prev: PickupFormState,
  formData: FormData,
): Promise<PickupFormState>;
```

`formData` keys: `slugToken` (hidden input wired by the page), `notes`, `urgency`, `sampleCount`.

### Route

- `GET /pickup/[slugToken]` — public, renders form or `notFound()`.
- Server action invoked via React `useFormState` (no dedicated HTTP route; same-origin).

## Implementation steps

1. **Verify public route allowance.** Read `/Users/abraham/lab-dispatch/lib/auth-rules.ts` and confirm `"/pickup/"` is in `PUBLIC_PATH_PREFIXES`. No code change; call this out in the PR description. (Already present at the time of writing.)
2. **Add `parseSlugToken` helper.** Write `lib/parse-slug-token.ts` per the contract above. Write `lib/parse-slug-token.test.ts` covering: `"acme-clinic-a7b2c3d4e5f6"` → ok; `"foo-bar-clinic-abcdef012345"` (multi-hyphen slug) → ok; `"acme-SHORT"` → null (token too short); `"acme-A7B2C3D4E5F6"` → null (uppercase token); `"acme"` (no hyphen) → null; `""` → null; `"-a7b2c3d4e5f6"` (empty slug) → null; `"123-a7b2c3d4e5f6"` (numeric-only slug) → ok; `"acme-a7b2c3d4e5f6x"` → null (too long).
3. **Add `estimateEtaText` helper.** Write `lib/eta.ts` returning the literal string and JSDoc-flag it as a placeholder. Write `lib/eta.test.ts` asserting the literal return.
4. **Add `TokenBucket`.** Write `lib/rate-limit.ts` implementing capacity/refill per key. On `tryConsume(key, now)`: lazy-initialize bucket for key; refill = `min(capacity, tokens + (now - updatedAt) * refillPerMs)`; if tokens ≥ 1, subtract 1 and return true, else return false. Store per-key state in a module-scope `Map`. Export a `reset()` method for tests. Write `lib/rate-limit.test.ts` covering: consumes up to capacity then denies; refills over time; independent keys; `reset()` clears.
5. **Extend storage interface + mock.** Add `findOfficeBySlugToken` to `interfaces/storage.ts` (and `createRealStorageService` stub that calls `notConfigured()`). Implement in `mocks/storage.ts` with a full scan (`for office of state.offices.values()` — match on slug, token, and active). Extend `mocks/storage.test.ts` with four cases: happy path, wrong token returns null, wrong slug returns null, `active: false` office returns null.
6. **Build the page.** Create `app/pickup/[slugToken]/page.tsx` as a server component. Steps: `parseSlugToken(params.slugToken)` → null ⇒ `notFound()`; `getServices().storage.findOfficeBySlugToken(slug, token)` → null ⇒ `notFound()`. Pass `{ slugToken: params.slugToken, officeName: office.name, officeCity: office.address.city, officeState: office.address.state, officePhone: office.phone }` down to `<PickupRequestForm />`.
7. **Build the form.** `app/pickup/[slugToken]/_components/PickupRequestForm.tsx` — client component. Render header "Request sample pickup — {officeName}" and the identification note. Fields: `<textarea name="notes" required minLength={10} maxLength={1000}>`, `<fieldset>` of three radio inputs (`name="urgency"`, values `routine`/`urgent`/`stat`, default `routine`), `<input type="number" name="sampleCount" min={1} max={99}>`. Hidden `<input type="hidden" name="slugToken" value={slugToken}>`. Render inline `fieldErrors` beneath each field; render top banner when `state.error` present. On `state.status === "ok"`: render success card ("Thanks! ... within about 2 hours. If this is urgent call us at {officePhone}.") — omit the phone clause if prop absent.
8. **Write the server action.** `app/pickup/[slugToken]/actions.ts`:
   - `"use server"` directive.
   - Read `slugToken`, `notes`, `urgency`, `sampleCount` from `formData`.
   - Rate-limit: `if (!pickupFormBucket.tryConsume(slugToken)) return { status: "error", error: "Too many requests. Please wait a few minutes and try again.", fieldErrors: {} };`.
   - Validate: `slugToken` present, `parseSlugToken` non-null (else generic error); `notes` length 10..1000 (field error); `urgency` in `["routine", "urgent", "stat"]` OR blank (blank → `"routine"`); `sampleCount` blank OR integer 1..99 (field error). Collect into `fieldErrors`; if any → return `{ status: "error", error: null, fieldErrors }`.
   - Look up office via `findOfficeBySlugToken`; null ⇒ return `{ status: "error", error: "This pickup link is no longer valid.", fieldErrors: {} }` (the page handles real 404s; here the action is a defensive check against mid-session deactivation).
   - `const request = await storage.createPickupRequest({ channel: "web", officeId: office.id, sourceIdentifier: slugToken, rawMessage: notes, urgency, sampleCount: sampleCount ?? undefined, specialInstructions: notes, status: "pending" });`.
   - Best-effort email: if `office.email` present, `await getServices().email.sendEmail({ to: office.email, subject: \`Pickup request received — ${office.name}\`, body: \`We got your request. ETA: ${etaText}. Notes: ${notes}\` })`. Wrap in try/catch; on throw, log to console and continue — do not fail the request.
   - Return `{ status: "ok", requestId: request.id, etaText: estimateEtaText() }`.
9. **Add custom 404.** `app/pickup/not-found.tsx` — minimal server component rendering the unknown-link copy. Plain styling matching the rest of the public shell.
10. **Write action tests.** `app/pickup/[slugToken]/actions.test.ts`. `beforeEach`: `resetAllMocks()` AND `pickupFormBucket.reset()`. Cases:
    - Happy path: seed office via `storage.createOffice`, call action with valid formData, assert returns `{ status: "ok" }`, assert `storage.listPickupRequests()` shows the new request with `channel: "web"`, `officeId`, `specialInstructions === notes`, and `getSentEmails()` contains one record addressed to the office email.
    - Notes missing → `fieldErrors.notes` present, no request created, no email sent.
    - Notes 5 chars → `fieldErrors.notes` present.
    - Unknown slugToken (parseable shape but no office) → `status: "error"`, generic banner, no request created.
    - Office email absent → happy path but `getSentEmails()` stays empty; no throw.
    - Rate-limit exceeded: call the action 11 times with valid input; the 11th returns `status: "error"` with the rate-limit copy; assert only 10 requests were persisted.
    - Invalid `urgency` value → `fieldErrors.urgency` present.
    - Invalid `sampleCount` (e.g., `"0"`, `"100"`, `"abc"`) → `fieldErrors.sampleCount` present.
11. **Smoke-wire the URL admins already see.** No code change — confirm `app/admin/offices/[id]/_components/EditOfficeForm.tsx` already shows `/pickup/${slug}-${pickupUrlToken}`. Flag in PR description so QA can copy-paste one end-to-end.

## Tests to write

- `/Users/abraham/lab-dispatch/lib/parse-slug-token.test.ts` — happy (single-hyphen slug), multi-hyphen slug (`foo-bar-clinic-a1b2c3d4e5f6`), uppercase token rejected, short token rejected, long token rejected, non-alphanumeric token rejected, empty input rejected, slug-only (no token) rejected, numeric-only slug (`123-a1b2c3d4e5f6`) accepted.
- `/Users/abraham/lab-dispatch/lib/eta.test.ts` — pins the literal `"within about 2 hours"`.
- `/Users/abraham/lab-dispatch/lib/rate-limit.test.ts` — consumes up to capacity then denies; refills after time passes (pass deterministic `now`); independent keys don't share tokens; `reset()` wipes state; capacity 0 always denies.
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — `findOfficeBySlugToken` happy, wrong token, wrong slug, inactive office.
- `/Users/abraham/lab-dispatch/app/pickup/[slugToken]/actions.test.ts` — cases listed in step 10.

No visual/E2E tests in scope for v1; the test surface is all pure functions, the mock, and the server action.

## External services touched

- **Storage (Supabase eventually)** — via `StorageService`. Reads `findOfficeBySlugToken`; writes `createPickupRequest`.
- **Email (Postmark eventually)** — via `EmailService.sendEmail`. Best-effort, non-blocking. Mock stores in `getSentEmails()` for assertions.
- **No SMS, no Mapbox, no Anthropic.** The form is identified by URL, so there is no AI parsing step. ETA is a static helper until the dispatcher-routing feature lands.

## Open questions

1. **Rate-limit copy vs. enforcement window.** 10 submissions per 5 minutes per slugToken is the stated v1 default. If a legitimate clinic hits this (e.g., a receptionist submits separately for every patient), the copy says "wait a few minutes." Flag: should the v1 ceiling be higher (e.g., 30 / 5 min) given that there's one bucket per office, not per IP? Current plan uses 10 / 5 min as requested; revisit after first real-world traffic.
2. **Inactive office lookup policy.** Mock `findOfficeBySlugToken` returns null for `active: false` offices, matching the page's `notFound()` contract. Do we also want an audit-log entry when a deactivated office's URL is hit (so admin can see the link is in the wild)? Out of scope for v1; flagging for the observability/analytics feature later.
3. **Success-page phone number.** If `office.phone` is absent, the plan drops the "call us at {phone}" sentence entirely. Alternative is a lab-wide fallback number — but SPEC doesn't define a canonical lab phone number yet. Current plan: omit when absent. Revisit once a lab-settings feature exists.
4. **Email subject/body localization.** SPEC is English-only for v1, so hardcoded English is fine. No action needed now.
