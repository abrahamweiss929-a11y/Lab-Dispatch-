# app/

Next.js App Router tree. Later features will introduce the route groups `(marketing)`, `(auth)`, and `(app)` — this project uses parenthesized route groups to segment public marketing pages, authentication flows, and the authenticated application shell without affecting URL paths. This feature does not create those group directories; each is added by the feature that owns it (auth, driver, dispatcher, admin).

Tests that target a route or a route-local component stay colocated in a `__tests__/` directory next to the route (for example `app/__tests__/page.test.tsx`). Cross-module integration tests live in the top-level `tests/` directory.
