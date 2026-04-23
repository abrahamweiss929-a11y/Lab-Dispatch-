# Phase 2 Report — HIGH Fixes (F-05, F-06)

**Branch:** `feature/fix-login-redirect-loop`
**Final test count:** 698/698 (was 679 before Phase 2 — +19 new tests)
**Typecheck:** 0 errors throughout

---

## What was fixed

### F-06 — Raw ISO timestamp in admin drivers list
**Commit:** `be53d05`

`app/admin/drivers/page.tsx:62` was rendering `{d.createdAt}` directly in the table cell, producing a raw ISO string like `2026-04-22T14:07:00Z` instead of a human-readable date.  Added the existing `formatShortDateTime` import and wrapped the cell value.

Regression test: added a test to `lib/dates.test.ts` asserting that `formatShortDateTime` output does not match the raw ISO shape `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/`.

---

### F-05 — `noValidate` sweep across all server-action forms
**Commit:** `fc66921`

HTML5 constraint validation (`required`, `minLength`) was firing in the browser before server actions ran, which permanently hid server-side `fieldErrors` from users — a submit on an empty required field would be intercepted by the browser and the React error UI would never render.

Applied two changes to every form that submits to a server action:
1. Added `noValidate` to the `<form>` element.
2. Removed every `required` and `minLength` attribute that could trigger native blocking validation.  `maxLength`, `min`, `max`, and `step` were left in place — they never block submission, they only constrain the value.

**9 forms updated:**
| File | Changes |
|---|---|
| `app/pickup/[slugToken]/_components/PickupRequestForm.tsx` | `noValidate`, removed `required` + `minLength={10}` from textarea |
| `app/admin/drivers/new/_components/NewDriverForm.tsx` | `noValidate`, removed `required` from fullName + email |
| `app/admin/drivers/[id]/_components/EditDriverForm.tsx` | `noValidate`, removed `required` from fullName |
| `app/admin/doctors/new/_components/NewDoctorForm.tsx` | `noValidate`, removed `required` from officeId select + name |
| `app/admin/doctors/[id]/_components/EditDoctorForm.tsx` | `noValidate`, removed `required` from officeId select + name |
| `app/admin/offices/new/_components/NewOfficeForm.tsx` | `noValidate`, removed `required` from name, street, city, state, zip |
| `app/admin/offices/[id]/_components/EditOfficeForm.tsx` | `noValidate`, removed `required` from name, street, city, state, zip |
| `app/dispatcher/routes/new/_components/NewRouteForm.tsx` | `noValidate`, removed `required` from driverId select + routeDate |
| `app/dispatcher/requests/new/_components/NewManualRequestForm.tsx` | `noValidate`, removed `required` from officeId + urgency selects |

`app/dispatcher/routes/[id]/_components/AddStopForm.tsx` has no inputs and no validation attributes — no changes needed.

Regression test: `app/forms-no-html5-validation.test.ts` — 18 tests (2 per form): one asserting `noValidate` is present, one asserting no `required` attribute remains.  Any future addition of `required` to these forms without also considering server-side validation will be caught immediately.

---

## What wasn't fixed

Both HIGH findings in scope were fixed.  No skips.

---

## Remaining issues (from Phase 0 / Phase 1 carry-over)

| ID | Severity | Summary |
|---|---|---|
| F-09 | MEDIUM | No graceful path for signed-in driver with deactivated/missing `drivers` row |
| F-10 | MEDIUM | `assignRequestToRoute` + related ops are non-atomic (accepted for v1) |
| F-11 | LOW | `listOffices`/`listDrivers` don't filter by `active=false` |
| F-12 | LOW | Rotate API keys before production deploy |

---

## Test count delta

| Checkpoint | Tests |
|---|---|
| End of Phase 1 | 679 |
| After F-06 | 680 |
| After F-05 | **698** |
