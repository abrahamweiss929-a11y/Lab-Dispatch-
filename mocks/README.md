# mocks/

In-memory and fake implementations of the ports declared in `interfaces/`, used by unit and integration tests as well as local development. These must never be imported from production code paths. Add one file per interface as interfaces land.

## Auto-seed

`seedMocks()` in `mocks/seed.ts` pre-fills the in-memory storage with a believable demo (6 offices, 10 doctors, 4 drivers, 20 pickup requests across all four channels and all four statuses, 5 inbound messages, 2 routes for today, and a trail of driver GPS pings). `interfaces/getServices()` calls it automatically the first time it runs in the mock branch, so `pnpm dev` boots onto populated screens without manual setup. Gates:

- Tests never auto-seed: `NODE_ENV=test` short-circuits the hook (and `vitest.setup.ts` calls `resetAllMocks()` before every test, which also clears the seed flag).
- Opt out in dev by setting `SEED_MOCKS=false` — the app will boot onto empty screens.
- The seed runs at most once per process. The flag survives Next.js HMR by anchoring on `globalThis.__labDispatchSeeded`.
