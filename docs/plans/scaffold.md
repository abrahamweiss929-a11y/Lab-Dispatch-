# Plan: Scaffold Next.js App Router Project

**Slug:** scaffold
**SPEC reference:** Tech stack (Next.js App Router, TypeScript). Foundation for all v1 features IN.
**Status:** draft

## Goal
Stand up an empty-but-runnable Next.js 14+ App Router project with TypeScript, Tailwind CSS, and Vitest so that every subsequent feature (auth, driver view, dispatcher map, intake channels, AI parsing, admin CRUD) has a single consistent baseline to build against. No business logic lands in this feature — only tooling, config, and a smoke test proving the stack boots and tests run.

## Out of scope
- Supabase client, schema, migrations, or `.env` wiring (later feature: `supabase-setup`)
- Auth flows, role checks, middleware (later feature: `auth`)
- Mapbox, Twilio, Postmark/SendGrid, Anthropic SDK integration or their interface wrappers
- Any domain UI (driver route view, dispatcher map, request queue, admin CRUD)
- Pickup intake endpoints (SMS webhook, email webhook, per-office web form)
- CI config, deployment config, Vercel project linking
- E2E test runner (Playwright/Cypress) — v1 uses Vitest for unit/component only at this stage
- Design system / component library beyond a Tailwind-styled placeholder page
- ESLint custom rules beyond the Next.js default

## Files to create or modify
- `/Users/abraham/lab-dispatch/package.json` — dependencies, devDependencies, scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`)
- `/Users/abraham/lab-dispatch/tsconfig.json` — strict TypeScript config with Next.js defaults and `@/*` path alias to `./`
- `/Users/abraham/lab-dispatch/next.config.js` — minimal Next config (empty object export, reactStrictMode true)
- `/Users/abraham/lab-dispatch/next-env.d.ts` — Next.js type reference (generated on first `next dev`/`next build`; added to .gitignore per Next convention OR committed — commit it to keep repo buildable without first run)
- `/Users/abraham/lab-dispatch/tailwind.config.ts` — Tailwind config with `content` pointing at `./app/**/*.{ts,tsx}` and `./components/**/*.{ts,tsx}`
- `/Users/abraham/lab-dispatch/postcss.config.js` — PostCSS config loading `tailwindcss` and `autoprefixer`
- `/Users/abraham/lab-dispatch/vitest.config.ts` — Vitest config with `jsdom` environment, path alias mirroring tsconfig, globals enabled
- `/Users/abraham/lab-dispatch/vitest.setup.ts` — Vitest setup importing `@testing-library/jest-dom` matchers
- `/Users/abraham/lab-dispatch/.gitignore` — node_modules, .next, coverage, .env*, .DS_Store, next-env.d.ts NOT ignored
- `/Users/abraham/lab-dispatch/.nvmrc` — pin Node version (e.g. `20`)
- `/Users/abraham/lab-dispatch/app/layout.tsx` — root layout with `<html>`, `<body>`, imports `./globals.css`, exports `metadata`
- `/Users/abraham/lab-dispatch/app/page.tsx` — placeholder home page rendering "Lab Dispatch" heading styled with Tailwind
- `/Users/abraham/lab-dispatch/app/globals.css` — Tailwind `@tailwind base; @tailwind components; @tailwind utilities;`
- `/Users/abraham/lab-dispatch/app/__tests__/page.test.tsx` — smoke test rendering `<Page />` and asserting the heading exists
- `/Users/abraham/lab-dispatch/README.md` — replace placeholder with project one-liner, prerequisites (Node 20), install step, and the full script list

## Interfaces / contracts
None. This feature ships no runtime interfaces, no API routes, no exported types. The only contracts are the npm script names, which later features will rely on:

- `npm run dev` — starts Next.js dev server on :3000
- `npm run build` — production build
- `npm run start` — serves the production build
- `npm run lint` — `next lint`
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — `vitest run`

## Implementation steps
1. Create `/Users/abraham/lab-dispatch/.gitignore` and `/Users/abraham/lab-dispatch/.nvmrc`. Verify `.gitignore` excludes `node_modules`, `.next`, `coverage`, `.env*.local`, `.DS_Store`.
2. Create `/Users/abraham/lab-dispatch/package.json` with `name: "lab-dispatch"`, `private: true`, the six scripts listed above, and dependencies: `next@^14`, `react@^18`, `react-dom@^18`. DevDependencies: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `tailwindcss`, `postcss`, `autoprefixer`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `eslint`, `eslint-config-next`.
3. Create `/Users/abraham/lab-dispatch/tsconfig.json` using Next.js 14 strict defaults, `"paths": { "@/*": ["./*"] }`, include `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`.
4. Create `/Users/abraham/lab-dispatch/next.config.js` exporting `{ reactStrictMode: true }`.
5. Create `/Users/abraham/lab-dispatch/postcss.config.js` and `/Users/abraham/lab-dispatch/tailwind.config.ts` (content globs for `./app` and `./components`, empty `theme.extend`, empty `plugins`).
6. Create `/Users/abraham/lab-dispatch/app/globals.css` with the three Tailwind directives.
7. Create `/Users/abraham/lab-dispatch/app/layout.tsx` exporting a default `RootLayout({ children })` that wraps children in `<html lang="en"><body>{children}</body></html>` and imports `./globals.css`. Export a `metadata` object with `title: "Lab Dispatch"`.
8. Create `/Users/abraham/lab-dispatch/app/page.tsx` exporting a default `Page()` that returns a `<main>` with an `<h1>` reading "Lab Dispatch" and a short tagline, styled with a couple of Tailwind utility classes to prove Tailwind compiles.
9. Create `/Users/abraham/lab-dispatch/vitest.config.ts` with `environment: "jsdom"`, `globals: true`, `setupFiles: ["./vitest.setup.ts"]`, `plugins: [react()]`, and path alias `@` → project root matching tsconfig.
10. Create `/Users/abraham/lab-dispatch/vitest.setup.ts` importing `@testing-library/jest-dom/vitest`.
11. Create `/Users/abraham/lab-dispatch/app/__tests__/page.test.tsx` — renders `<Page />` with `@testing-library/react`, asserts `screen.getByRole("heading", { name: /lab dispatch/i })` is in the document.
12. Create `/Users/abraham/lab-dispatch/next-env.d.ts` with the standard Next.js triple-slash references so `tsc --noEmit` passes pre-build.
13. Replace `/Users/abraham/lab-dispatch/README.md` content with: project one-liner pulled from SPEC.md, "Prerequisites: Node 20 (see `.nvmrc`)", "Install: `npm install`", and a bulleted list of the six scripts with a one-line description each.
14. Run the verification gate locally: `npm install`, then `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. All four must pass before this feature is considered complete.

## Tests to write
- `/Users/abraham/lab-dispatch/app/__tests__/page.test.tsx` — renders the home page and asserts the "Lab Dispatch" heading is present. This test's job is solely to prove the Vitest + React Testing Library + jsdom + path-alias pipeline works end-to-end; it is not a product test.

## External services touched
None. No SMS, email, Anthropic, Mapbox, or Supabase clients are introduced or wrapped in this feature. First external service wiring happens in the `supabase-setup` feature.

## Open questions
None.
