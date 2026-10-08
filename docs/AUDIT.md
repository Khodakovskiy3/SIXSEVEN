# Cluvyra — Repository Audit (SIXSEVEN / OLIMP → Cluvyra)

Audit date: 2026-10-08 · Branch: `feature/cluvyra-startup` (from `github/main` @ `f3def72`)

Scope: Express API (`server/`), PostgreSQL schema and migrations (`db/`), vanilla JS
frontend and PWA (`public/`), Docker/Compose, Electron wrapper, scripts and tests.

Severity: **Critical** — exploitable or blocks production; **High** — real security or
data-integrity risk; **Medium** — reliability/operability problem; **Low** — hygiene.

## 1. Findings and decisions

| # | Area | Finding | Severity | Decision |
|---|------|---------|----------|----------|
| 1 | Auth / OTP | `server/routes/auth.js` returns the one-time code as `devCode` whenever SMTP is missing **or** `DEBUG_OTP=1`. A production deploy without SMTP hands every 2FA/registration code to the requester — 2FA becomes decorative. | Critical | `devCode` is returned only when `NODE_ENV !== 'production'` **and** `DEBUG_OTP=1`. In production without SMTP, OTP endpoints return `503` instead of issuing an undeliverable code. Startup fails if `DEBUG_OTP=1` in production. |
| 2 | Mailer | `server/utils/mailer.js` prints OTP codes to stdout when SMTP is missing or `DEBUG_OTP=1` (codes end up in hosted log storage). | High | Codes are logged only in non-production with `DEBUG_OTP=1`. Sender address comes from `SMTP_FROM`; no hardcoded domain. |
| 3 | Config | `.env.example` ships `DEBUG_OTP=1`, `JWT_SECRET=change_me…`. | High | New `.env.example` with `DEBUG_OTP=0`, empty secrets, documented variables only. |
| 4 | JWT | `middleware/auth.js` falls back to `'change_me'` if `JWT_SECRET` is unset (only `index.js` guards production). Tokens survive password changes; algorithm not pinned. | High | Central config validation: production requires `JWT_SECRET` ≥ 32 chars. `HS256` pinned. New `users.token_version` claim — password change / role change revokes existing tokens. |
| 5 | Demo data | `db/seed-test.sql` creates `admin` / `manager@olimp.ua` / … with the public password `admin123`; README advertises it. | Critical (if run in prod) | `npm run db:seed` refuses to run when `NODE_ENV=production`. New `npm run demo:seed` creates **synthetic** demo data with random (or owner-supplied) passwords, is idempotent, guarded by a DB marker and requires `DEMO_MODE=true` + `--confirm` in production. No credentials on the public site. |
| 6 | Payments | `POST /api/payments` lets a **client** insert a payment with any amount and `status='completed'` for themselves → falsified revenue analytics. | High | Restricted to admin/manager; amount and status validated. |
| 7 | IDOR | `GET /api/anthropometry/client/:clientId` — any trainer can read body measurements of any client. | High | Trainer may read only clients who have (had) a booking in one of their classes. |
| 8 | Booking race | `POST /api/bookings` counts active bookings then inserts, under READ COMMITTED without a lock. Two concurrent requests for the last seat both pass → over capacity. Same for single-visit passes. | High | Booking moved to `server/services/booking-service.js`: schedule row locked `FOR UPDATE`, subscription row locked, all checks inside one transaction. Integration test runs concurrent bookings for the last seat. |
| 9 | Booking rules | Classes in the past and inactive services can be booked; "today" is `new Date().toISOString()` (UTC), so between 00:00–03:00 Kyiv time subscriptions are evaluated against yesterday. | High | Start time compared with `now()` in `APP_TIMEZONE` in SQL (DST-safe); workout must be active; booking horizon limit. |
| 10 | Error leaks | `anthropometry.js` and `push.js` return `err.message` to clients. | Medium | Generic messages; details go to the log only. |
| 11 | Express 4 async | Rejected promises in `async` handlers are not forwarded to the error handler → request hangs until client timeout, `unhandledRejection` noise. | Medium | Express upgraded to v5 (native async error propagation). Routes audited for v5 breaking changes (no wildcard routes, `req.body` guarded). |
| 12 | Process safety | `uncaughtException` handler logs and keeps running in an undefined state. No `pool.on('error')` → an idle Postgres disconnect crashes the process. No graceful shutdown. | Medium | Pool error handler, graceful `SIGTERM` (Railway redeploys), exit on `uncaughtException` so the platform restarts a clean process. |
| 13 | DB config | `server/db.js` ignores `DATABASE_URL` (Railway's primary variable); no connection timeout or SSL option. | Critical for Railway | `DATABASE_URL` preferred, `PG*` fallback for local dev, `DATABASE_SSL`, connect/statement timeouts. |
| 14 | Migrations | `server/migrate.js` re-executes **every** SQL file on every start; relies on each file being idempotent forever. A fresh database (Railway) has no base schema — migration `001` alters `visits`, which does not exist; the base schema was only applied by the Docker `initdb` mount. Concurrent starts can race. | Critical for Railway | `schema_migrations` ledger + checksums, `pg_advisory_lock`, one transaction per file. Empty DB → `db/schema.sql` baseline then all migrations; legacy DB without ledger → existing idempotent migrations re-applied once and recorded. Verified against real PostgreSQL. |
| 15 | Health | `/api/health` always returns `{ok:true}` even with DB down. | Medium | `/api/health` checks DB + migration state (503 otherwise); `/api/health/live` for liveness. |
| 16 | Runtime | Dockerfile uses Node 18 (EOL April 2025), runs as root, includes tests/docs/uploads. | High | `node:24-alpine`, `NODE_ENV=production`, non-root user, `HEALTHCHECK`, tightened `.dockerignore`. Python 3 + reportlab kept for PDF reports. |
| 17 | PWA | `public/sw.js` has a syntax error in `notificationclick` (`const` inside `waitUntil(...)` argument) → **the service worker fails to install at all**, so push click-through and offline fallback never worked. | High | Fixed; cache renamed/versioned; offline page rebranded; `/api` and uploads never cached. All JS files syntax-checked in tests. |
| 18 | Uploads | Images saved to `public/assets/uploads` — lost on every Railway redeploy; 4 uploaded photos are committed to Git (plus 6 untracked), i.e. user uploads leak into the public repo. | High | `UPLOADS_DIR` configurable (Railway volume, e.g. `/data/uploads`), served with `nosniff` + restrictive CSP; uploads removed from Git tracking and ignored. They remain in **Git history** — rewriting history needs owner approval (not done). |
| 19 | Body size | `express.json({ limit: '10mb' })` for every route. | Low | 1 MB default; 8 MB only on the upload route. |
| 20 | Rate limiting | `/api/auth` limit is 100 req/min/IP — too permissive for password/OTP guessing; no limits on guest chat. | Medium | Strict limiter on login/verify/register; general API limiter; AI per-user limiter + daily cap. In-memory (single instance) — documented. |
| 21 | Security headers | Only `nosniff` and `Referrer-Policy`. JWT is in `localStorage`, so XSS = account takeover. | Medium | CSP (`script-src 'self' 'unsafe-inline'` because of existing inline theme scripts; `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`), HSTS in production, `Permissions-Policy`. Frontend already escapes server data (`escapeHtml` helpers). Moving JWT to HttpOnly cookies would need CSRF protection and a rewrite of every `fetch` — deferred, see §3. |
| 22 | Background jobs | Reminders and planned messages run via `setInterval` in the web process; a second replica would duplicate notifications. | Medium | Each tick runs under `pg_try_advisory_lock` (one runner across replicas); `JOBS_ENABLED` switch. Single-instance deployment documented. |
| 23 | AI | `server/routes/ai.js` hard-depends on a local Ollama; prompt hardcodes "OLIMP" and forces Ukrainian; schedule context only for today; no booking ability. | — (product) | Provider abstraction (`AnthropicProvider`, `OllamaProvider`, `MockProvider`), Claude tool use with server-validated read-only tools, booking via server-side confirmation token. |
| 24 | Electron | `package.json` `extraResources` copies `.env` into the desktop bundle → every secret (DB password, JWT secret, SMTP, future `ANTHROPIC_API_KEY`) ships inside the app. | Critical (if built) | `.env` removed from the bundle and excluded from `files`. Electron is optional and not part of the Railway deploy. |
| 25 | Logging | Error log written to `logs/error.log` synchronously; registration errors log email addresses. | Low | File logging only when `LOG_DIR` is set (stdout on Railway); PII trimmed from new code paths. |
| 26 | Branding | "OLIMP" hardcoded in ~40 pages, manifest, SW, AI prompt. | — | Central config (`PRODUCT_NAME`, `ORGANIZATION_NAME`, …) + `GET /api/public/config`; Cluvyra product shell; OLIMP stays only as the demo organisation. |
| 27 | Self-service purchase | `POST /api/subscriptions/purchase` gives a client an active subscription and records a `completed` payment without any payment provider. | Medium (business) | Kept (existing feature, demo club), documented as "no real payment processing". Can be disabled per deployment later. |
| 28 | Repo hygiene | Course documents (`*.docx`), `OLIMP_landing.html`, graphify output exist locally; `.gitignore` already excludes `.docx`. | Low | No change to private documents. |

## 2. Verified as already sound

* SQL is parameterised everywhere checked (`$1…$n`); no string-built SQL with user input found.
* Passwords hashed with bcrypt; OTP codes stored as bcrypt hashes with attempt limits and TTL.
* Public registration always creates `client`; admins can only assign client/trainer; managers cannot create managers.
* Upload route validates MIME + magic bytes, random file names, admin-only.
* SSE uses short-lived one-time tickets instead of JWT in query strings.
* PDF report spawns `python3` with a fixed script path and JSON over stdin (no shell interpolation).

## 3. Accepted trade-offs (MVP)

* **JWT in `localStorage`.** Kept for this MVP. Mitigations: CSP, escaping helpers, token revocation via `token_version`, 7-day TTL. Migration to HttpOnly `SameSite=Strict` cookies + CSRF tokens is on the roadmap.
* **In-memory rate limits / SSE tickets / AI limiter** — correct for a single Railway instance; Redis-backed stores are needed before horizontal scaling.
* **Single organisation.** Tables have no `organization_id`; multi-tenancy is a roadmap item (see README).
* **Git history still contains uploaded photos** committed upstream (`public/assets/uploads/*.jpg`). Removing them requires a history rewrite and force-push — owner decision.
