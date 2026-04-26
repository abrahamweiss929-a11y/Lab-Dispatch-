# Phase D Migration — Apply to Existing Supabase Database

How to apply `supabase/migrations/2026-04-26-phase-d-invites.sql` to a
Supabase project that already has the baseline schema running.

> **Don't apply `supabase/schema.sql` to an existing database.** That
> file is the canonical "fresh project" definition and isn't safely
> re-runnable on top of an existing one. Use this migration instead.

---

## What this migration does

1. Adds `'office'` to the `user_role` enum.
2. Creates the `invite_status` enum.
3. Creates the `invites` table with indexes and RLS enabled.
4. Adds 4 admin-only RLS policies on `invites`.
5. Replaces `public.current_role()` in place (body unchanged — uses
   `create or replace function` so the ~30 dependent policies survive).
6. Widens 15 existing RLS policies from `('dispatcher','admin')` to
   `('dispatcher','admin','office')`.

The whole migration is **idempotent** — rerunning it is a no-op.

---

## Why two parts

Postgres requires a new enum value to be **committed** before any DDL
references it. Pasting the entire file at once in the Supabase SQL
editor fails with:

```
ERROR 55P04: unsafe use of new value 'office' of enum type user_role
```

…because the `invites` table's `check (role in ('office', 'driver'))`
constraint is in the same execution as the `alter type ... add value`.

The fix is operational, not technical: run the file in two pieces, with
a commit in between (the SQL editor commits when you click "Run").

---

## Step-by-step

### Step 1 — Open the Supabase SQL editor

Project → **SQL Editor** → **New query**.

### Step 2 — Run PART 1

Open `supabase/migrations/2026-04-26-phase-d-invites.sql`. Copy
**only** the line between the `▼▼▼ PART 1` and `▲▲▲ END OF PART 1`
banners:

```sql
alter type public.user_role add value if not exists 'office';
```

Paste into the SQL editor. Click **Run**.

**Success looks like:** "Success. No rows returned." No errors, no
notices. (If `'office'` already exists, the `if not exists` clause
silently no-ops — also success.)

### Step 3 — Open a fresh query tab

This forces the editor to start a new transaction, so PART 2 can see
`'office'` as a committed enum value.

> **Important:** Don't reuse the same tab. Some editor sessions keep
> an open transaction; opening a new tab guarantees a fresh one.

### Step 4 — Run PART 2

Copy everything from the `▼▼▼ PART 2` banner to the end of the file.
Paste into the new tab. Click **Run**.

**Success looks like:** A series of `NOTICE` lines for the
`drop policy if exists` statements that target policies you've already
got (e.g. `NOTICE: policy "profiles_select_dispatcher_admin" does not
exist on table "profiles", skipping`) — these are harmless and
expected on first run, then you'll see them all on subsequent reruns
since the policies will now exist and get dropped before recreate.

No `ERROR` lines should appear. If you see one, stop and read the
error message — the most likely causes are listed at the bottom of
this doc.

---

## Verification queries

Run each of these in the SQL editor after PART 2 completes. They prove
the three things the migration is responsible for.

### 1. `'office'` is a valid `user_role` enum value

```sql
select unnest(enum_range(null::public.user_role)) as role;
```

**Expect:** four rows — `driver`, `dispatcher`, `admin`, `office` (in
the order they were added).

### 2. The `invites` table exists with the right shape

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'invites'
order by ordinal_position;
```

**Expect:** 10 rows — `id`, `email`, `role`, `token`, `status`,
`invited_by_profile_id`, `created_at`, `expires_at`, `accepted_at`,
`accepted_by_profile_id`.

And confirm the role check constraint is in place:

```sql
select pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
where t.relname = 'invites' and c.contype = 'c';
```

**Expect:** at least one row whose `definition` contains
`CHECK ((role = ANY (ARRAY['office'::user_role, 'driver'::user_role])))`
or equivalent.

### 3. At least one widened policy admits the `office` role

```sql
select policyname, qual
from pg_policies
where schemaname = 'public'
  and policyname = 'profiles_select_dispatcher_admin';
```

**Expect:** one row whose `qual` (the USING expression) contains
`'office'` alongside `'dispatcher'` and `'admin'`. Something like:

```
(current_role() = ANY (ARRAY['dispatcher'::user_role, 'admin'::user_role, 'office'::user_role]))
```

For a fuller audit, check that all 15 widened policies admit `office`:

```sql
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and qual::text like '%office%'
order by tablename, policyname;
```

**Expect:** 15+ rows (15 widened + the 4 invites admin policies that
also happen to mention 'admin' but not 'office', so those won't match
this filter — what you want is the 15 widened ones to all show up).

A precise count of widened-only policies:

```sql
select count(*) as widened_count
from pg_policies
where schemaname = 'public'
  and qual::text like '%dispatcher%'
  and qual::text like '%office%';
```

**Expect:** exactly 15.

### 4. Smoke test: the invites table is writable by the service role

(Only run this if you have access via the service-role key, e.g.
through the API explorer — not from the SQL editor's anon context.)

```sql
-- Get an admin profile id to use as invited_by_profile_id
select id from public.profiles where role = 'admin' limit 1;

-- Insert a throwaway invite
insert into public.invites (email, role, token, invited_by_profile_id, expires_at)
values ('test@example.com', 'office', 'verify-token-abc', '<paste admin id>', now() + interval '7 days')
returning id;

-- Clean up
delete from public.invites where token = 'verify-token-abc';
```

---

## If something goes wrong

| Error code | Likely cause | Fix |
| --- | --- | --- |
| `55P04 unsafe use of new value 'office'` | You ran PART 1 + PART 2 in the same batch, or in the same transaction. | Click Run on PART 1 first. Open a new query tab. Run PART 2. |
| `2BP01 cannot drop function ... because other objects depend on it` | You ran the canonical `supabase/schema.sql` against the existing DB instead of this migration. | Don't do that. Use this migration. |
| `42P07 relation "invites" already exists` | Should not happen — the migration uses `create table if not exists`. If you see it, you're running a different file. | Re-check the file you pasted. |
| `42704 type "invite_status" does not exist` (during PART 2) | You skipped the `do $$ begin create type ... end $$` block. | Re-run PART 2 from the top of the section. |
| Migration succeeded but app code says role is undefined | App-side TypeScript types might be stale. | Restart the Next.js dev server / redeploy. |

---

## Rollback

If you need to undo the migration (rare — it's additive), the inverse
is roughly:

```sql
-- Drop invites table + policies (cascade clears policies)
drop table if exists public.invites cascade;
drop type if exists public.invite_status;

-- Revert each widened policy to ('dispatcher', 'admin') by dropping
-- and recreating without 'office'. (Copy from the baseline
-- supabase/schema.sql at commit df4784a.)
```

You **cannot** remove an enum value (`'office'`) from `user_role` once
added. Postgres has no `ALTER TYPE ... DROP VALUE`. If you need to
permanently revoke `'office'`, you'd have to migrate every row that
uses it to a different role first, then leave the enum value in place
unused. In practice: don't add `'office'` until you actually want it.

---

## After applying

- The app code on `feat/invite-flow` (or the merged
  `test/all-phases-combined` branch) will work end-to-end against the
  migrated DB.
- The in-memory `lib/invites-store.ts` still needs to be replaced with
  Supabase-backed storage methods before going to production. The
  column shape in this migration matches `lib/invites-store.ts`'s
  `Invite` interface 1:1.
- Phase D's `acceptInviteAction` still mints a fake `userId` via
  `makeRandomId()`. In production, swap that for
  `supabase.auth.admin.createUser({ email, email_confirm: true })`
  and an explicit `profiles` insert before `setSession`.

See `artifacts/PHASE_D_REPORT.md` for the full out-of-scope list.
