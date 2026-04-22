# Plan: Mock message inbox handler + AI parsing pipeline

**Slug:** message-inbox
**SPEC reference:** "Pickup request channels (no doctor logins)" → SMS and Email subsections. "AI message parsing". "Confirmation flow". "Unknown-sender handling".
**Status:** draft

## Goal

Accept inbound SMS (Twilio-style) and email (Postmark-style) webhooks, persist every raw message, resolve the sender to a known office, run the body through the AI parser, and create either a `pending` or `flagged` `PickupRequest` linked back to the message — auto-replying on every branch. Unknown senders get a polite brush-off and land in the dispatcher inbox for review. A dev-only "simulate inbound" panel on `/dispatcher/messages` exercises the same pipeline without HTTP so the v1 demo works entirely against mocks.

## Out of scope

- Real Twilio signature verification on `/api/sms/inbound` — deferred until live Twilio credentials land (see `BLOCKERS.md [twilio]`). Plan step adds a TODO comment pointing at that blocker.
- Real Postmark signature / secret-path verification on `/api/email/inbound` — deferred (see `BLOCKERS.md [postmark]`).
- STOP / HELP / opt-out SMS compliance handling (Twilio handles STOP server-side in v1; we do not parse it ourselves).
- Bounce / complaint / spam-report webhooks from Postmark.
- Multi-part MIME parsing, attachment handling, forwarded-email thread stripping. `TextBody` is taken as-is; `HtmlBody` is only used as a fallback and is passed through untouched (AI mock already treats body as opaque text).
- Translating AI freeform responses into strict urgency enums — `storage.createPickupRequest` already accepts the `PickupUrgency` union and the AI mock only returns valid values. Real `AiService` adapter is responsible for sanitizing before returning.
- Per-office ETA computation (still uses `estimateEtaText()` from the pickup-form feature).
- Web-channel ingestion (already handled by the pickup-form feature).

## Files to create or modify

### New — library helpers

- `/Users/abraham/lab-dispatch/lib/phone.ts` — `normalizeUsPhone(input: string): string | null`.
- `/Users/abraham/lab-dispatch/lib/phone.test.ts` — unit tests.
- `/Users/abraham/lab-dispatch/lib/inbound-pipeline.ts` — exports `handleInboundMessage(input)` + the `InboundPipelineResult` union type. Owns all business logic; both the HTTP routes and the dispatcher simulation call it.
- `/Users/abraham/lab-dispatch/lib/inbound-pipeline.test.ts` — unit tests for the four branches.
- `/Users/abraham/lab-dispatch/lib/inbound-rate-limits.ts` — module-scope `TokenBucket` singletons keyed per channel (`smsInboundBucket`, `emailInboundBucket`), each 30 / min. Lives next to `rate-limit.ts` so that one file stays a pure class and this file holds the singletons for the webhook layer (mirrors how `rate-limit.ts` currently exposes `pickupFormBucket`).

### New — API routes

- `/Users/abraham/lab-dispatch/app/api/sms/inbound/route.ts` — `POST` handler. Parses `application/x-www-form-urlencoded` body, pulls `From` and `Body`, rate-limits on `From`, calls `handleInboundMessage`. Always returns HTTP 200 so Twilio does not retry on our bugs; the response body mirrors `InboundPipelineResult` for developer debuggability.
- `/Users/abraham/lab-dispatch/app/api/sms/inbound/route.test.ts` — unit tests. Uses a `vi.mock("@/lib/inbound-pipeline")` spy so the route test stays focused on HTTP parsing + rate-limit wiring.
- `/Users/abraham/lab-dispatch/app/api/email/inbound/route.ts` — `POST` handler. Parses JSON body, pulls `From`, `Subject`, `TextBody` (fallback `HtmlBody`), rate-limits, calls the pipeline.
- `/Users/abraham/lab-dispatch/app/api/email/inbound/route.test.ts` — unit tests.

### Modified — storage interface + mock

- `/Users/abraham/lab-dispatch/interfaces/storage.ts` — add four methods (`createMessage`, `findOfficeByPhone`, `findOfficeByEmail`, `linkMessageToRequest`), plus a `NewMessage` input type. Add `notConfigured()` stubs in `createRealStorageService`.
- `/Users/abraham/lab-dispatch/mocks/storage.ts` — implement the four methods against `state.messages` / `state.offices`.
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — extend with describe blocks for each new method.

### Modified — dispatcher UI

- `/Users/abraham/lab-dispatch/app/dispatcher/messages/page.tsx` — mount `<SimulateInboundPanel />` (conditionally rendered only when `process.env.USE_MOCKS !== "false"`). No other layout change.
- `/Users/abraham/lab-dispatch/app/dispatcher/messages/_components/SimulateInboundPanel.tsx` — new client component. Two side-by-side forms (SMS / Email) wired to `simulateInboundAction`. Uses `useFormState` for a small success/error banner.
- `/Users/abraham/lab-dispatch/app/dispatcher/messages/actions.ts` — extend with `simulateInboundAction`. Calls `requireDispatcherSession()` + `handleInboundMessage` directly (no HTTP), then `revalidatePath("/dispatcher/messages")` + `"/dispatcher/requests"`. Guards on `USE_MOCKS` and throws if called in real mode (defense-in-depth — the panel will not render anyway).
- `/Users/abraham/lab-dispatch/app/dispatcher/messages/actions.test.ts` — extend existing file with a new `describe("simulateInboundAction")` block.

### Modified — auth-rules (public routes)

- `/Users/abraham/lab-dispatch/lib/auth-rules.ts` — verify `PUBLIC_PATH_PREFIXES` already contains `/api/sms/inbound` and `/api/email/inbound`. If not, add them. (The middleware must let webhook POSTs through without a session.)

### Verification only (no change expected)

- `/Users/abraham/lab-dispatch/interfaces/index.ts` — already re-exports the storage types and `Services`. No edit needed.

## Interfaces / contracts

### `lib/phone.ts`

```ts
/**
 * Normalizes a US phone number to E.164 (`+1XXXXXXXXXX`).
 * - Strips every non-digit.
 * - Accepts 10 digits (assumes US country code) or 11 digits that start with `1`.
 * - Returns null on anything else (empty, too short, too long, non-1 country code).
 */
export function normalizeUsPhone(input: string): string | null;
```

### `StorageService` additions

```ts
export interface NewMessage {
  channel: PickupChannel;            // "sms" | "email" (pipeline never calls with "web" | "manual")
  fromIdentifier: string;
  subject?: string;
  body: string;
  receivedAt?: string;               // defaults to now
  pickupRequestId?: string;          // almost always unset at create-time
}

/** Inserts a `messages` row. Returns the stored Message. */
createMessage(input: NewMessage): Promise<Message>;

/**
 * Matches an office by `phone`. Caller is responsible for normalization;
 * for symmetry the mock re-normalizes both sides via `normalizeUsPhone`
 * so that offices stored with loose formatting still match. Returns null
 * on no match or when the matching office is inactive.
 */
findOfficeByPhone(phone: string): Promise<Office | null>;

/**
 * Matches an office by `email`, case-insensitive. Trims surrounding
 * whitespace on both sides. Returns null on no match or inactive.
 */
findOfficeByEmail(email: string): Promise<Office | null>;

/**
 * Updates `messages.pickupRequestId`. Throws `"message <id> not found"` on
 * bad id. Idempotent when the target id already matches; throws
 * `"message already linked"` when the stored id differs.
 */
linkMessageToRequest(messageId: string, pickupRequestId: string): Promise<Message>;
```

### `lib/inbound-pipeline.ts`

```ts
export interface InboundMessageInput {
  channel: "sms" | "email";
  from: string;                      // raw sender identifier as received
  subject?: string;                  // email only
  body: string;
}

export type InboundPipelineResult =
  | { status: "unknown_sender"; messageId: string }
  | { status: "flagged"; requestId: string; messageId: string }
  | { status: "received"; requestId: string; messageId: string }
  | { status: "error"; messageId?: string };    // pipeline swallowed a bug

export async function handleInboundMessage(
  input: InboundMessageInput,
): Promise<InboundPipelineResult>;
```

Normalization rules applied inside the pipeline:
- SMS: `from = normalizeUsPhone(input.from) ?? input.from`. If normalization fails we still store the message with the raw `from`, but the office lookup will miss and the branch becomes unknown-sender.
- Email: `from = input.from.trim().toLowerCase()` for lookup; stored `fromIdentifier` is the lowercased/trimmed form as well (canonical).

Auto-reply copy (exact strings, pinned by tests):
- Unknown sender: `"Thanks for reaching out. This number/email isn't set up for pickups yet. Please contact the lab directly to register."`
- Low-confidence (flagged): `"Thanks — we got your message and a team member will confirm shortly."`
- High-confidence (received): ``We received your pickup request for ${count} samples. A driver will be there within about 2 hours.`` where `count` is `parsed.sampleCount ?? "your"` — i.e. when sample count is unknown the copy reads "We received your pickup request for your samples." (Tested both branches.)

Email auto-replies use subject `"Re: <original subject>"` when `subject` is present, else `"Pickup request received"`.

Error handling: the pipeline is wrapped in a top-level try/catch that, on any throw AFTER the initial `createMessage` has already succeeded, logs via `console.error` and returns `{ status: "error", messageId }`. If `createMessage` itself throws, the error bubbles — the route handler then catches it, logs, and still returns HTTP 200 with `{ status: "error" }` body (so Twilio/Postmark do not retry). This is the "drop on bug" behavior described in the scope.

### HTTP route contracts

- `POST /api/sms/inbound`
  - Content-Type: `application/x-www-form-urlencoded`. Required fields: `From`, `Body`.
  - Response: always HTTP 200 JSON. Bodies: `{ status: "received" | "flagged" | "unknown_sender" | "error" | "rate_limited" | "invalid_payload" }`. Rate-limited responses still return 200 (Twilio retries on 4xx/5xx).
- `POST /api/email/inbound`
  - Content-Type: `application/json`. Required fields: `From`, one of `TextBody` or `HtmlBody`. `Subject` optional.
  - Response: same shape as above.

### Dispatcher action

```ts
export type SimulateInboundFormState =
  | { status: "idle"; message: null }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export async function simulateInboundAction(
  prev: SimulateInboundFormState,
  formData: FormData,
): Promise<SimulateInboundFormState>;
```

`formData` keys: `channel` (`"sms" | "email"`), `from`, `subject` (email only), `body`.

## Implementation steps

1. **Verify public-path allowance for webhooks.** Read `lib/auth-rules.ts`. Ensure `/api/sms/inbound` and `/api/email/inbound` are in `PUBLIC_PATH_PREFIXES` (or the equivalent matcher). If missing, add both. Bare minimum addition; do not refactor the existing shape.
2. **Add phone normalization.** Write `lib/phone.ts` per the contract. Strip everything non-digit; if 11 digits and leading `1`, drop it; if exactly 10 digits, return `"+1" + digits`; else return null. Write `lib/phone.test.ts` covering: `"+1 (555) 123-4567"`, `"555-123-4567"`, `"5551234567"`, `"15551234567"`, `"+15551234567"`, empty string, `"1-800-FLOWERS"` (letters rejected — only digits count but result length 4 → null), `"+44 20 1234 5678"` (UK, 13 digits → null), `"123"` (too short → null), `"123456789012"` (too long → null).
3. **Extend storage interface.** In `interfaces/storage.ts`: add `NewMessage` interface, add the four method signatures to `StorageService`, and add four `notConfigured()` stubs to `createRealStorageService()`. Re-export `NewMessage` via `interfaces/index.ts` type block so downstream code can import it through the usual path.
4. **Implement storage mock methods.**
   - `createMessage`: mint id via `makeRandomId()`, default `receivedAt = nowIso()`, insert into `state.messages`. Return the stored record.
   - `findOfficeByPhone(phone)`: normalize input via `normalizeUsPhone`; if null, return null. Iterate `state.offices.values()`, normalize each office's `phone`, and return the first where both normalized values match AND `active === true`. Null on miss.
   - `findOfficeByEmail(email)`: lowercase+trim input; iterate offices and return first where `office.email?.toLowerCase().trim() === input` AND `active === true`. Null on miss.
   - `linkMessageToRequest`: read `state.messages.get(id)`; throw `"message <id> not found"` on miss; if `message.pickupRequestId` already set to something *different* → throw `"message already linked"`; else write `{ ...message, pickupRequestId }` and return it.
5. **Test storage mock additions.** In `mocks/storage.test.ts`, add describe blocks:
   - `createMessage` — inserts, returns record, `listMessages()` then shows it.
   - `findOfficeByPhone` — matches after normalization of BOTH sides (seed an office with `phone: "(555) 123-4567"`, look up `"+15551234567"` → match); miss on wrong number; miss on inactive; miss on null normalization (`"abc"`).
   - `findOfficeByEmail` — case-insensitive match; miss on wrong address; miss on inactive.
   - `linkMessageToRequest` — happy path; not-found; already-linked-to-different-id throws; re-linking to same id is a no-op (returns the stored record).
6. **Add inbound rate-limit singletons.** Write `lib/inbound-rate-limits.ts`. Two `TokenBucket` singletons with `capacity: 30, refillPerMs: 30 / 60_000`. Document keyed by normalized `from`. No new tests — the `TokenBucket` class is already covered.
7. **Write the shared pipeline.** Write `lib/inbound-pipeline.ts`. Steps inside `handleInboundMessage`:
   1. Compute `canonicalFrom`: SMS → `normalizeUsPhone(from) ?? from`; email → `from.trim().toLowerCase()`.
   2. `const msg = await storage.createMessage({ channel, fromIdentifier: canonicalFrom, subject, body })`.
   3. Wrap the remainder in a try/catch that on error logs and returns `{ status: "error", messageId: msg.id }`.
   4. Look up office: SMS → `findOfficeByPhone(canonicalFrom)`; email → `findOfficeByEmail(canonicalFrom)`.
   5. If null: send unknown-sender auto-reply via the matching channel (SMS `sms.sendSms({ to: canonicalFrom, body: UNKNOWN_COPY })`, email `email.sendEmail({ to: canonicalFrom, subject: replySubject, body: UNKNOWN_COPY })`). Return `{ status: "unknown_sender", messageId: msg.id }`. Skip auto-reply if SMS normalization failed (`canonicalFrom` is still the raw junk `from`) — it is better to leave the message for dispatcher review than to send to a malformed destination. Tested.
   6. Else: `const parsed = await ai.parsePickupMessage({ channel, from: canonicalFrom, body })`.
   7. Build `const pickupInput: NewPickupRequest = { channel, officeId: office.id, urgency: parsed.urgency ?? "routine", sampleCount: parsed.sampleCount, specialInstructions: parsed.specialInstructions, sourceIdentifier: canonicalFrom, rawMessage: body, status: parsed.confidence < 0.6 ? "flagged" : "pending", flaggedReason: parsed.confidence < 0.6 ? "ai_low_confidence" : undefined }`.
   8. `const request = await storage.createPickupRequest(pickupInput)`.
   9. `await storage.linkMessageToRequest(msg.id, request.id)`.
   10. Send confirmation auto-reply matching branch (flagged-ack vs received). Return the matching result.
8. **Test the pipeline.** Write `lib/inbound-pipeline.test.ts`. `beforeEach`: `resetAllMocks()`. Cases:
   - **Unknown sender — SMS.** No office seeded. Call pipeline with SMS `from="+15550001111"`. Assert: `getSent()` has one SMS with `to: "+15550001111"` and unknown-sender copy; message row stored with `channel: "sms"`, `fromIdentifier: "+15550001111"`, `pickupRequestId === undefined`; no pickup requests created.
   - **Unknown sender — email.** Same but email side; assert the stored `fromIdentifier` is lowercased+trimmed.
   - **Unknown sender — SMS with unparseable `from`.** Input `from="not-a-phone"`. Assert message row stored with raw `from` (unchanged), NO SMS sent (since we will not send to garbage), result is `unknown_sender`.
   - **Low-confidence parse → flagged.** Seed an office with phone `+15550002222`. Stub `ai.parsePickupMessage` (via `vi.spyOn(aiMock, "parsePickupMessage").mockResolvedValueOnce({ confidence: 0.4, urgency: "routine" })`). Call pipeline. Assert: one pickup request with `status: "flagged"`, `flaggedReason: "ai_low_confidence"`, `officeId` set, `sourceIdentifier: "+15550002222"`; message linked to that request; one SMS sent with the flagged-ack copy.
   - **High-confidence parse → received, with sample count.** Seed office; spy returns `{ confidence: 0.9, urgency: "urgent", sampleCount: 3, specialInstructions: "fridge" }`. Assert request `status: "pending"`, urgency `"urgent"`, `sampleCount: 3`, `specialInstructions: "fridge"`; message linked; SMS sent with `"for 3 samples"` in the body.
   - **High-confidence parse, no sample count.** Spy returns `{ confidence: 0.8, urgency: "routine" }`. Assert the SMS reads `"for your samples"` (explicit check for the plan's "your" fallback).
   - **Email path parity.** One email happy-path case asserting the auto-reply uses `email.sendEmail`, `to` is the lowercased address, `subject` starts with `"Re: "` when input subject present and falls back otherwise.
   - **Pipeline error after message stored.** `vi.spyOn(storageMock, "createPickupRequest").mockRejectedValueOnce(new Error("boom"))`. Assert the message row exists, NO auto-reply was sent, result is `{ status: "error", messageId }`. (This asserts the "swallow bug" contract.)
9. **Write the SMS route.** `app/api/sms/inbound/route.ts`:
   - Export `async function POST(req: Request)`.
   - Read `await req.formData()`; extract `From`, `Body`. If either missing/non-string → return `Response.json({ status: "invalid_payload" }, { status: 200 })`.
   - Rate-limit on `From`: if `!smsInboundBucket.tryConsume(String(From))` → return `{ status: "rate_limited" }` 200.
   - Call `handleInboundMessage({ channel: "sms", from: String(From), body: String(Body) })`. Return the result as JSON with 200 regardless.
   - Wrap the pipeline call in try/catch; on throw log + return `{ status: "error" }` 200.
   - Add a `// TODO(blockers:twilio)` comment above the handler noting signature verification lives there.
10. **Test the SMS route.** `app/api/sms/inbound/route.test.ts`. `vi.mock("@/lib/inbound-pipeline", () => ({ handleInboundMessage: vi.fn() }))`. `vi.mock("@/lib/inbound-rate-limits", () => ({ smsInboundBucket: { tryConsume: vi.fn(() => true) } }))`. Cases:
    - Happy: POST form body `From=...&Body=...`. Pipeline stub returns `{ status: "received", ... }`. Assert route returns 200 JSON with that payload and pipeline was called with `{ channel: "sms", from, body }`.
    - Missing `Body`: 200 with `{ status: "invalid_payload" }`; pipeline NOT called.
    - Rate-limit: stub `tryConsume` returns false; 200 with `{ status: "rate_limited" }`; pipeline NOT called.
    - Pipeline throws: stub rejects; 200 with `{ status: "error" }`; no uncaught reject.
11. **Write the email route.** `app/api/email/inbound/route.ts`:
    - `POST`: `const body = await req.json()`. Pull `From`, `Subject`, `TextBody`, `HtmlBody`. Choose `body = TextBody ?? HtmlBody`. If `From` missing or `body` missing → `invalid_payload`.
    - Rate-limit via `emailInboundBucket` on `From`.
    - Call pipeline; same 200-always behavior.
12. **Test the email route.** `app/api/email/inbound/route.test.ts`. Same pattern as SMS. Additional case: `HtmlBody`-only payload (TextBody missing) → pipeline called with the `HtmlBody` string as `body`.
13. **Dispatcher simulate panel (server action).** Extend `app/dispatcher/messages/actions.ts`:
    - Add `simulateInboundAction`. On entry: `requireDispatcherSession()`. Guard: `if (process.env.USE_MOCKS === "false") throw new Error("Simulate inbound is disabled in real mode")`.
    - Pull `channel`, `from`, `subject`, `body` from form data. Minimal validation: `channel` in `["sms", "email"]`, `from` non-empty, `body` non-empty (return `error` state on failure with user-readable message).
    - `const result = await handleInboundMessage({ channel, from, subject: channel === "email" ? subject : undefined, body });`.
    - Translate `result.status` to a banner message: `"received"` → `"Simulated — created pickup request."`, `"flagged"` → `"Simulated — created flagged request."`, `"unknown_sender"` → `"Simulated — auto-replied to unknown sender."`, `"error"` → `"Simulated — pipeline errored. See server logs."`
    - `revalidatePath("/dispatcher/messages")` + `revalidatePath("/dispatcher/requests")`.
    - Return `SimulateInboundFormState`.
14. **Dispatcher simulate panel (UI).** Create `app/dispatcher/messages/_components/SimulateInboundPanel.tsx`:
    - `"use client"`.
    - Two forms side by side (SMS / Email) inside a bordered card titled "Simulate inbound (mock mode only)". Each uses its own `useFormState(simulateInboundAction, IDLE_STATE)`.
    - SMS form: `<input name="channel" type="hidden" value="sms">`, `<input name="from" placeholder="+15551234567">`, `<textarea name="body">`, submit button "Send test SMS".
    - Email form: hidden `channel=email`, `<input name="from">`, `<input name="subject">`, `<textarea name="body">`, submit "Send test email".
    - Render the state banner per form ("ok" green / "error" red).
15. **Mount the panel.** Edit `app/dispatcher/messages/page.tsx`: just before the filter nav, render `{process.env.USE_MOCKS !== "false" && <SimulateInboundPanel />}`. Panel rendering is server-side (page is a server component), so the env flag is evaluated there — the client bundle does not have to re-check it.
16. **Extend dispatcher action tests.** Add to `app/dispatcher/messages/actions.test.ts`:
    - New `describe("simulateInboundAction")`.
    - `beforeEach`: `resetAllMocks()`; `vi.stubEnv("USE_MOCKS", "true")`.
    - Case: valid SMS formData → returns `{ status: "ok" }`; assert `storage.listMessages()` has one row; `revalidatePathMock` called twice.
    - Case: validation failure (`from` empty) → `{ status: "error" }`; no message created.
    - Case: `USE_MOCKS=false` → the action throws; no storage side-effect. (`vi.stubEnv("USE_MOCKS", "false")` scoped to the test.)
    - Case: auth failure short-circuits before pipeline (mirror the existing pattern).
17. **Manual smoke in PR description.** Document two curl commands (SMS, email) hitting the dev server, plus a note that the dispatcher simulate panel is the preferred demo path. Not a code artifact — goes in the PR body.

## Tests to write

- `/Users/abraham/lab-dispatch/lib/phone.test.ts` — normalization happy / reformat / reject non-US / reject short / reject long / reject letters-only (via post-strip length).
- `/Users/abraham/lab-dispatch/lib/inbound-pipeline.test.ts` — eight cases listed in step 8.
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — four new describe blocks (`createMessage`, `findOfficeByPhone`, `findOfficeByEmail`, `linkMessageToRequest`).
- `/Users/abraham/lab-dispatch/app/api/sms/inbound/route.test.ts` — happy / invalid payload / rate-limit / pipeline-throws.
- `/Users/abraham/lab-dispatch/app/api/email/inbound/route.test.ts` — happy / TextBody / HtmlBody fallback / invalid payload / rate-limit / pipeline-throws.
- `/Users/abraham/lab-dispatch/app/dispatcher/messages/actions.test.ts` — four new cases under `describe("simulateInboundAction")`.

## External services touched

- **SMS (Twilio eventually)** — via `SmsService`. Reads webhook payloads inbound; writes auto-replies via `sms.sendSms`. Mock stores outbound in `getSent()` for assertions.
- **Email (Postmark eventually)** — via `EmailService`. Reads webhook JSON inbound; writes auto-replies via `email.sendEmail`. Mock stores outbound in `getSentEmails()`.
- **AI (Anthropic eventually)** — via `AiService.parsePickupMessage`. Mock uses keyword heuristics; tests stub responses directly to exercise the confidence threshold.
- **Storage (Supabase eventually)** — via `StorageService`. New methods: `createMessage`, `findOfficeByPhone`, `findOfficeByEmail`, `linkMessageToRequest`.
- **No Mapbox, no Auth** on these routes — webhooks are public.

## Open questions

1. **Auto-reply to malformed SMS `from`.** The plan's position is: if `normalizeUsPhone` returns null (e.g., Twilio forwards a short code or a ten-digit-looking spam number Twilio labels differently), store the message and DROP the auto-reply — do not attempt to `sms.sendSms` with the raw garbage `to`. Is that correct, or should we reply with the raw value and let Twilio reject it downstream? Current plan: drop. Revisit if dispatchers report the inbox fills with spam they never get visibility on (they do — the message still shows in the inbox, just without an auto-reply record).
2. **Inactive-office lookup policy.** `findOfficeByPhone` / `findOfficeByEmail` return null for deactivated offices (same policy as `findOfficeBySlugToken`). That means a deactivated office hitting the inbox falls through to unknown-sender auto-reply. Confirm this matches product intent. Alternative: match inactive offices but still flag; we chose the simpler "unknown-sender" path because it matches the "please contact the lab" copy exactly.
3. **Email `From` header variants.** Postmark's `From` is sometimes `"Office Name <office@example.com>"` rather than a bare address. Plan assumes the bare-address form (real Postmark adapter will split `FromFull.Email` off before calling the route). For v1 mock mode we only document the bare-address expectation; we do not parse name-with-angle-bracket forms in the route. Flag: add RFC5322-style parsing if demo input ever includes the full form.
4. **Dispatcher simulate panel exposure.** Panel is gated on `USE_MOCKS !== "false"`, which is server-side. When we flip the app to real mode, the panel disappears. Do we also want a build-time strip of the unused client component? Low priority — Next.js tree-shakes unused imports when the server component stops referencing it. No action needed now.
