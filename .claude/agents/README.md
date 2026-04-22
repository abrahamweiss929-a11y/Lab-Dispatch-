# Lab Dispatch sub-agent team

Six specialized sub-agents collaborate to build Lab Dispatch features one at a time. The orchestrator (the main Claude session) picks a feature, then drives the loop below.

## The team

| Agent | Model | Writes code? | Writes files? | Purpose |
|-------|-------|--------------|---------------|---------|
| [planner](planner.md) | sonnet | no | `docs/plans/*.md` only | Turns a SPEC feature into a concrete, sequenced plan |
| [builder](builder.md) | sonnet | yes | source + tests | Executes the plan one feature at a time; tests alongside code; external services behind interfaces |
| [test-runner](test-runner.md) | haiku | no | no | Runs the unit suite; reports failures with `file:line` |
| [debugger](debugger.md) | sonnet | no | no | Diagnoses failing tests; proposes a specific fix |
| [reviewer](reviewer.md) | sonnet | no | no | Scans the diff for quality/security issues; returns PASS or FAIL |
| [git-keeper](git-keeper.md) | haiku | no | git state only | Commits to `feature/{slug}` with a Conventional Commit message |

## Ground rules

- **SPEC.md is the source of truth.** The planner refuses anything under "v1 features OUT".
- **One feature at a time.** Builder works on exactly one `docs/plans/{slug}.md` per invocation.
- **Tests are non-negotiable.** Builder writes a test for every piece of business logic.
- **External services are wrapped.** Anything touching Twilio, Postmark/SendGrid, Anthropic, Mapbox, or Supabase goes through `interfaces/{service}.ts` with a mock in `interfaces/mocks/`. Tests use the mock.
- **`main` is sacred.** Git-keeper commits only to `feature/*` branches and never pushes.

## The full loop

For each feature in the SPEC:

```
┌─────────────┐
│  planner    │  reads SPEC.md → writes docs/plans/{slug}.md
└──────┬──────┘
       ▼
┌─────────────┐
│  builder    │  implements plan + writes tests
└──────┬──────┘
       ▼
┌─────────────┐
│ test-runner │  runs unit suite
└──────┬──────┘
       │
   ┌───┴────┐
  PASS     FAIL
   │        │
   │        ▼
   │   ┌─────────────┐
   │   │  debugger   │  diagnoses → proposes fix (file:line)
   │   └──────┬──────┘
   │          ▼
   │   ┌─────────────┐
   │   │  builder    │  applies fix → loop back to test-runner
   │   └─────────────┘
   ▼
┌─────────────┐
│  reviewer   │  checks diff
└──────┬──────┘
       │
   ┌───┴────┐
  PASS     FAIL
   │        │
   │        ▼
   │   ┌─────────────┐
   │   │  builder    │  fixes blocking issues → loop back to test-runner
   │   └─────────────┘
   ▼
┌─────────────┐
│ git-keeper  │  commits to feature/{slug}
└─────────────┘
```

Textual form:

1. **planner** → `docs/plans/{slug}.md`
2. **builder** → implements plan + tests
3. **test-runner** → runs suite
   - on FAIL → **debugger** → **builder** (apply fix) → back to **test-runner**
4. **reviewer** → scans diff
   - on FAIL → **builder** (fix blocking issues) → back to **test-runner**
5. **git-keeper** → commit on `feature/{slug}`
6. Orchestrator picks the next feature.

## Invocation notes for the orchestrator

- Always pass the feature slug when invoking builder, reviewer, or git-keeper.
- Never invoke git-keeper unless the most recent test-runner was PASS **and** the most recent reviewer was PASS.
- If the planner returns Open Questions, resolve them with the user before invoking the builder.
- If the builder returns `PLAN_INSUFFICIENT`, re-invoke the planner with the builder's questions attached — do not improvise.
