# Cluvyra — demo script (Claude booking assistant)

All data in the demo studio ("OLIMP Demo") is **synthetic** (`npm run demo:seed`, `@example.com`
addresses). Do not publish demo passwords; the seed prints them once to the owner's terminal.

**Demo URL:** `<Railway public URL>` — *to be filled by the owner after the live check below*.
Landing: `/` · App sign-in: `/app` · Privacy: `/privacy` · Terms: `/terms`.

**Roles needed:** `client`, `admin` (2FA code is emailed — SMTP must be configured), `manager` (same).

## Pre-flight (2 min)

1. `GET /api/health` returns `{ ok: true }` (DB + migrations ready).
2. `AI_ENABLED=true`, `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` set in Railway (never shown).
3. Demo schedule has classes for tomorrow after 18:00 (the seed creates a 4-week schedule; re-run
   `demo:seed --reset-passwords --confirm` only if accounts must be rotated).

## Demo 1 — Client books through Claude (≈2 min)

1. Sign in as the demo **client** → open the AI chat.
2. Type: **"Хочу завтра після 18:00 на групове тренування."** (English works too.)
3. Expected: Claude resolves "tomorrow after 18:00" in `Europe/Kyiv`, calls `search_classes`, and
   lists **only classes that exist in PostgreSQL** with free seats and trainer names.
4. Pick one ("перше") → Claude calls `prepare_booking` and shows a **confirmation card**.
5. Press **Confirm** → the server re-checks seat, membership dates, duplicates; creates the booking.
6. Expected: success message; the booking appears under *My bookings*. Pressing **Decline** (or an
   expired card) creates nothing.

Edge cases to mention/show: full class, no/expired membership, already booked, second user taking
the last seat first — all rejected by the backend with a clear message.

## Demo 2 — Admin sees the booking (≈1 min)

1. Sign in as **admin** (email 2FA) → schedule view for the booked class.
2. Expected: seat count increased by one; the client is listed; admin can cancel or edit the schedule.

## Demo 3 — Manager sees the numbers (≈1 min)

1. Sign in as **manager** → analytics: attendance, revenue by synthetic payments, visits, AI usage
   metrics (`/api/ai/metrics`: request counts, tokens, latency — no message content).

## What problem Claude solves (one paragraph)

Studio front desks answer the same scheduling questions all day ("what's free tomorrow evening?").
Claude turns a free-form request into calls to a small set of **user-scoped backend tools**; it
never touches SQL, never sees a confirmation token, and cannot book for another person. The
booking is only created when the member confirms and the server re-validates every rule.

## Honest status of this script

* Flow verified with the **mock provider** in integration tests and in the browser (earlier run).
* **Live Claude API verified (2026-10-13)** on Railway via `npm run smoke:live`: real model
  `claude-sonnet-5-5`, tool call returned real classes, prepare → confirm created a booking.
  Details in `docs/IMPLEMENTATION_STATUS.md`.
* **Not yet walked through in the browser on the live URL** — do this once before sharing the link.
