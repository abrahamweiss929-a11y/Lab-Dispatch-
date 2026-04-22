# Lab Dispatch System — v1 Spec

A web-based logistics platform for a US medical laboratory that
coordinates drivers picking up samples from doctors' offices.

## Account types

- **Driver** — mobile web interface. Sees today's route, stops in
  order, map, "arrived" and "picked up" buttons.
- **Dispatcher** (lab secretary) — desktop web portal. Live map of
  all drivers, today's pickup request queue, route assignment tools.
- **Admin** — manages driver accounts, doctor contacts, historical
  reports (last 30 days).

## Pickup request channels (no doctor logins)

- **SMS** — doctor's office texts the lab's number. Identified by
  phone number. AI parses the message to extract urgency, sample
  count, special instructions. System auto-replies with confirmation
  and ETA.
- **Email** — doctor's office emails pickup@ourlab.com. Identified
  by email address. Same AI parsing flow.
- **Per-office web link** — each office gets a unique bookmarkable
  URL (/pickup/{office-slug}-{random}). Form is pre-identified, has
  a notes field plus optional urgency and sample-count fields.

## Unknown-sender handling

Auto-reply with polite brush-off + flag message in dispatcher inbox
for review.

## Live tracking

GPS sampling every 1–2 minutes when driver is on an active route.
Manual "arrived" and "picked up" check-ins at each stop. Driver
interface is mobile web only (no native app for v1).

## AI message parsing

Incoming SMS/email → Claude API → extracts sender, urgency, sample
count, special instructions → creates structured pickup request →
auto-replies with confirmation. Messages the AI can't parse
confidently are flagged for human review.

## Confirmation flow

Every pickup request gets an automatic reply with ETA. When a
driver is ~10 minutes from a stop, the doctor's office gets a
heads-up text.

## Tech stack

- Next.js (App Router, TypeScript)
- Supabase (Postgres + Auth + Realtime + Storage)
- Mapbox (maps and routing)
- Twilio (SMS)
- Postmark or SendGrid Inbound (email receiving)
- Anthropic API (message parsing)
- Vercel (hosting)

## v1 features IN

- Logins for 3 account types
- Driver route view + check-ins + GPS tracking
- Dispatcher live map + request queue + route assignment
- Three pickup request channels with AI parsing
- Auto-confirmations
- Unknown-sender handling
- Admin CRUD for drivers and doctors

## v1 features OUT

- Billing
- Driver performance reports
- Multi-language
- Native mobile apps
- Lab software integrations
- Automatic route optimization
- Analytics beyond "last 30 days"

## Region

US only. English only. Timezones handled per-lab.
