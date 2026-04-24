# Route-completion state fix

Branch: `fix/route-completion-state` (off `main`)
Commit: `131c83e`

## The actual bug

The reported symptom — "route {id} is not active" ugly Next.js error page on `/driver` after completing a route — was reproducible via this path:

1. Driver completes their route. `completeRouteAction` flips status to `completed` and redirects to `/driver`.
2. Driver navigates back to `/driver/route` (back button, bookmark, second tab).
3. The route page renders with `route.status === "completed"`, all stops still picked up.
4. **Buggy render gate**: `app/driver/route/page.tsx:129` showed `<CompleteRouteButton>` whenever `allPickedUp && session.role === "driver"`. It didn't check status. So the button rendered for completed routes.
5. Driver clicks. Server action throws `route ${id} is not active`. Next.js shows the error page.

So there were two defects — one UI (the button shouldn't render at all) and one server action (even if it *does* get hit, crashing is the wrong response for an idempotent "done" operation).

## What changed

### `app/driver/actions.ts` — `completeRouteAction`

| Route status | Before | After |
|---|---|---|
| `active`, all stops picked up | Transition → `completed`, redirect `/driver` | Same |
| `active`, stop(s) not picked up | Throw `"pending stops"` | Same (still a real error) |
| `completed` | Throw `"not active"` → error page | **`redirect("/driver")`** — idempotent no-op |
| `pending` | Throw `"not active"` → error page | **`console.warn` + `redirect("/driver")`** |
| missing / wrong driver | Throw | Same — these are real errors, not edge cases |

The idempotent branch uses `redirect()` (which Next.js unwinds gracefully through its `NEXT_REDIRECT` sentinel), so the driver lands on `/driver` exactly as they would after a normal completion. No user-visible error.

### `app/driver/route/page.tsx` — UI guard

- Added `route.status === "active"` to the `CompleteRouteButton` render gate. It was previously gated only by `allPickedUp && session.role === "driver"`, which let the button leak into the completed state.
- Added a friendly `"This route is already completed."` green note for `status === "completed"` so the page explains itself rather than looking like a dead screen.

### `app/driver/page.tsx` — no change needed

The home/today page was already correctly gated on `route.status === "active"` around its `CompleteRouteButton`. Only the `/driver/route` view had the leak.

## Tests

Two new regression cases in `app/driver/actions.test.ts` under `driver server actions — completeRouteAction`:

1. **"redirects home without error when the route is already completed"** — seeds an active route, completes it, then invokes `completeRouteAction` a second time. Expects a redirect (not a throw) and asserts that no second storage transition happens.
2. **"redirects home without error when the route is still pending, and logs a warning"** — seeds a pending route and invokes the action. Expects a redirect, no storage transition, and a `console.warn` containing `unexpected status "pending"`.

Existing tests continue to hold:
- Active + all picked up → completes and redirects (golden path).
- Active + any unpicked stop → throws `"pending stops"`.
- Wrong driver → throws `"not your route"`.
- Auth failure → bubbles up.

**Suite:** 700 tests pass, typecheck clean.

## State-machine invariant — unchanged

Per the task rules, I didn't touch the `updateRouteStatus` state machine or introduce any new status. The only transitions the action performs are still `active → completed`. Every other branch either redirects without calling storage, or throws for the unrecoverable cases that predated this fix (missing route, wrong driver, pending stops).

## Deferred / not done

- `startRouteAction` has the same shape of edge case: throwing `"is not pending"` on a double-tap. Not reported; not fixed here. Low risk because the Start button is only rendered on `/driver` home when `status === "pending"`, so an already-active route doesn't leak the button the way the completed route did on `/driver/route`. Worth a follow-up if you want symmetry.
- The dispatcher's `RouteStatusControls` (which also transitions routes) uses a different code path — not in scope for this report.
