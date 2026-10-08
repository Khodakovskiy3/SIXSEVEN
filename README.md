# Cluvyra

**Run your studio. Simplify every booking.**

Cluvyra is an AI-powered management platform that helps fitness and wellness businesses manage bookings, schedules, memberships, clients and communication in one place.

> **Status: Early-stage MVP — actively developing.** Single-organisation deployment (demo studio “OLIMP Demo”). No customers, revenue or partnerships are claimed. See [Current status](#current-status).

---

## Product overview

Cluvyra grew out of a working sports-club management system (SIXSEVEN / OLIMP, built as a course project). It is now being turned into a B2B SaaS product for studios: one place for the front desk, trainers, owners and members — with a Claude-powered assistant that turns natural-language requests into real, rule-checked bookings.

## Problem

Small and mid-size studios run on spreadsheets, messengers and memory. Schedules, memberships and payments live in different tools; the front desk answers “is there space tomorrow evening?” all day; classes get overbooked; owners lack a clear picture of attendance and revenue.

## Solution

* A single web app (installable PWA) with role-based workspaces for members, trainers, admins and managers.
* Online booking that enforces capacity and membership rules in the database transaction.
* An AI assistant built on Anthropic’s Claude API that understands requests like *“tomorrow after 18:00, a group class”*, searches the live schedule and prepares the booking — which the member then confirms.

## Features (implemented)

| Area | What works today |
|---|---|
| Accounts & security | Registration with email verification, JWT sessions with revocation, mandatory email 2FA for staff, roles: client / trainer / admin / manager |
| Schedule | Services with capacity & duration, trainer assignment with specialisation and overlap checks |
| Booking | Real-time seats, cancellation & re-booking, membership/access-type checks, single-visit passes, past/inactive/horizon guards, row-locked transactions (no overbooking) |
| Memberships & payments | Plans (subscription / single), assignment & self-service purchase (no payment provider yet), payment records, expiry reminders |
| Attendance | Visit tracking, trainer views of their classes and clients |
| Communication | Announcements (all / group / selected / scheduled), in-app notifications, Web Push, live chat between visitors/members and the front desk |
| Analytics | Revenue, attendance, trainer load, class popularity, PDF reports (Python/reportlab) |
| Body measurements | Member anthropometry history; trainers see only their own clients |
| PWA | Installable app, offline fallback page, push notification handling |
| Landing & legal | Public marketing site, early-access form (stored in DB), Privacy/Terms drafts |

## AI features

| Capability | Status |
|---|---|
| Fitness assistant (training technique, workout structure, recovery, general nutrition — no medical advice) | ✅ Implemented |
| AI booking assistant: intent → clarification → real slots → membership/capacity check → explicit confirmation → booking | ✅ Implemented |
| Ukrainian & English (replies in the user’s language) | ✅ Implemented |
| AI lead recovery, member follow-ups, staff copilot, AI business insights | 🗓 Planned |

## Claude integration

* **SDK:** official `@anthropic-ai/sdk`, server-side only. `ANTHROPIC_API_KEY` never reaches the browser, PWA or Electron.
* **Model:** configurable via `ANTHROPIC_MODEL` (default `claude-opus-5-5`; `claude-sonnet-5-5` or `claude-haiku-4-5` for lower cost). `ANTHROPIC_EFFORT` (default `low`) controls thinking depth for chat. For Claude 5.x models the request opts into server-side refusal fallback (`fallbacks: "default"`).
* **Provider abstraction:** `AnthropicProvider` (production), `OllamaProvider` (optional local dev), `MockProvider` (tests). Missing Ollama never affects production; a missing API key returns a clear `503` (and blocks a production start while `AI_ENABLED=true`).
* **Tool use (manual, bounded loop):** `search_classes`, `get_class_availability`, `get_my_bookings`, `get_my_membership`, `prepare_booking`. Arguments are validated with zod; tools run fixed parameterised SQL scoped to the signed-in user. The model never writes SQL and cannot select another user.
* **Confirmation:** `prepare_booking` stores a pending confirmation (SHA-256 of a random token, bound to user + client + slot, 10-minute TTL). Only the browser receives the token; `POST /api/ai/bookings/confirm` atomically claims it once and creates the booking through the same booking service as the REST API, re-checking every rule. Text from the model is never treated as proof of a booking.
* **Cost control:** per-user requests/minute and daily cap, max tokens, history limit, per-call timeout, bounded SDK retries, max tool rounds and tool calls per round, usage metrics without message text (`ai_usage_events`, `GET /api/ai/usage`), `AI_ENABLED=false` kill switch.

## Architecture

```
Browser / PWA (vanilla JS)          Railway
 ├─ Landing, /privacy, /terms        ┌──────────────────────────────┐
 ├─ Cabinets per role ── HTTPS ───▶  │ Node 24 · Express 5          │
 └─ AI chat widget                   │  ├─ REST API (/api/*)        │
                                     │  ├─ booking-service (locks)  │
                                     │  ├─ AI orchestrator ──────────┼──▶ Claude API
                                     │  │   └─ tools (scoped SQL)    │
                                     │  ├─ jobs (advisory locks)     │
                                     │  └─ uploads → /data volume    │
                                     └──────────────┬───────────────┘
                                                    ▼
                                         Railway PostgreSQL
                                         (schema_migrations ledger)
```

Key modules: `server/config.js` (all env + validation), `server/app.js` (Express app), `server/index.js` (boot, migrations, jobs, graceful shutdown), `server/migrate.js`, `server/services/booking-service.js`, `server/ai/*`.

## Tech stack

Node.js 24 · Express 5 · PostgreSQL 15+ (`pg`) · vanilla HTML/CSS/JS (ES modules, no build step) · `@anthropic-ai/sdk` · zod · bcryptjs · jsonwebtoken · nodemailer · web-push · Python 3 + reportlab (PDF) · Docker · Railway.

## Local setup

```bash
npm ci
cp .env.example .env            # set PGPASSWORD and JWT_SECRET (openssl rand -hex 32)
docker compose up -d db         # local PostgreSQL
npm run dev                     # applies migrations, starts on http://localhost:3000
npm run demo:seed               # optional: synthetic demo studio, prints demo passwords once
```

Without SMTP, set `DEBUG_OTP=1` in your local `.env` to see one-time codes in the console (never in production). For a free local AI backend: `AI_PROVIDER=ollama`, `ollama pull qwen3:8b`, `npm run dev:ollama`.

Pages: `/` landing · `/app` application entry (PWA start URL) · `/pages/auth/login.html` · `/privacy` · `/terms`.

## Environment variables

See [`.env.example`](.env.example) for the full, commented list. Required in production:

| Variable | Purpose |
|---|---|
| `NODE_ENV=production` | Enables production safety checks |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | ≥ 32 random characters |
| `ANTHROPIC_API_KEY` | Required while `AI_ENABLED=true` |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Email codes (registration, staff 2FA). Without SMTP those flows return 503 |
| `UPLOADS_DIR` | Persistent volume path for uploaded images (e.g. `/data/uploads`) |
| `APP_URL`, `PUBLIC_SITE_URL`, `SUPPORT_EMAIL`, `ORGANIZATION_NAME` | Branding / links |

## Database

* Migrations live in `db/migrations/*.sql` and are tracked in `schema_migrations` (filename + checksum), applied once each, in order, one transaction per file, under a PostgreSQL advisory lock.
* Empty database → `db/schema.sql` baseline, then all migrations. Existing pre-Cluvyra database (no ledger) → historical idempotent migrations are re-applied once and recorded. Nothing is ever dropped automatically.
* `npm run db:migrate` runs the same code (Railway pre-deploy command).
* `npm run db:seed` (legacy test data with a known password) refuses to run in production; use `npm run demo:seed`.

## Deployment

Railway (web service + Railway PostgreSQL + volume). Step-by-step guide: [`docs/RAILWAY_DEPLOYMENT.md`](docs/RAILWAY_DEPLOYMENT.md). Infrastructure as Code: [`.railway/railway.ts`](.railway/railway.ts). Docker image: `node:24-alpine`, non-root, healthcheck on `/api/health`.

The Docker Compose stack (`docker-compose.yml`: PostgreSQL, daily backups, Caddy HTTPS, optional Ollama) remains available for self-hosting.

## Testing

```bash
npm test                    # unit: syntax of all JS (incl. service worker), config, timezone/DST, AI providers
npm run check:syntax
# integration (real PostgreSQL; each file creates and drops its own database):
TEST_DATABASE_URL=postgres://postgres:pass@localhost:5432/postgres npm run test:integration
```

Integration suites cover migrations (fresh, repeated, concurrent), auth/OTP/roles/token revocation, production OTP behaviour, booking rules and concurrency (last seat, single-visit pass), and the AI assistant with a mock provider (tool validation, unauthorized tools, prompt injection, confirmation tokens, timeouts). Tests never call the real Claude API. Results: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Security

Summary of controls — details and accepted trade-offs in [`docs/AUDIT.md`](docs/AUDIT.md):
startup config validation · OTP never logged/returned in production · bcrypt · JWT HS256 with revocation · role checks on every route · IDOR fixes · parameterised SQL · CSP and security headers · rate limits (auth, API, public forms, AI) · upload MIME + magic-byte validation on a separate volume · no secrets in the frontend or Electron bundle · generic error responses.

Known trade-off: the JWT is stored in `localStorage` (mitigated by CSP/escaping); HttpOnly cookies + CSRF protection are on the roadmap.

## Roadmap

* HttpOnly cookie sessions + CSRF tokens
* Multi-organisation (tenant) support, per-studio branding and domains
* Payment provider integration for memberships
* AI lead recovery, member follow-ups, staff copilot, AI business insights
* English UI for cabinets (landing is English; cabinets are Ukrainian today)
* Redis-backed rate limits / job queue for horizontal scaling

## Current status

Early-stage MVP — actively developing. Ready for a manual single-instance deployment on Railway; external steps (Railway project, Anthropic API key, SMTP, domain) are listed in [`docs/RAILWAY_DEPLOYMENT.md`](docs/RAILWAY_DEPLOYMENT.md) and tracked in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

Planned domains (`cluvyra.com`, `app.cluvyra.com`) and the `hello@cluvyra.com` mailbox are **not yet registered**.

## Optional components

* **Electron** (`electron/`): desktop wrapper. Set `CLUVYRA_REMOTE_URL=https://…` to use it as a thin client for a deployed instance. Not part of the Railway deployment; the installer never includes `.env` or secrets.
* **Self-hosted backups** (`db-backup` service in Docker Compose) — see `scripts/db-backup*.sh`.
