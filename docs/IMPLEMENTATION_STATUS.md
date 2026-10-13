# Cluvyra — implementation status

Branch: `feature/cluvyra-startup` · Last update: 2026-10-08

Legend: ✅ done & verified · 🟡 done, partially verified · ⏳ PENDING EXTERNAL VERIFICATION · ❌ not done

## Phases

| Phase | Status | Notes |
|---|---|---|
| 1. Repository audit | ✅ | [`docs/AUDIT.md`](AUDIT.md) — 28 findings with decisions |
| 2. Production infrastructure | 🟡 | Node 24 Dockerfile, `DATABASE_URL`, migration ledger, health, graceful shutdown, Railway IaC. **Docker image build not verified locally** (see “Environment limitations”). |
| 3. Security | ✅ | OTP, JWT revocation, config validation, payments, IDOR, CSP, rate limits, uploads, Electron secrets |
| 4. PWA / existing functionality | ✅ | Service worker syntax error fixed (old file did not parse at all), manifest/icons, regression suites |
| 5. Claude AI | ✅ / ⏳ | Provider abstraction, assistant, booking tools, confirmation tokens, limits. **Real Claude API call not executed** (no API key) |
| 6. Branding | ✅ | Logo, icons, brand layer for all cabinets, central config, `GET /api/public/config` |
| 7. Landing & documentation | ✅ | Landing, `/privacy`, `/terms`, README, Railway guide, startup application draft |
| 8. Testing | ✅ | 79 unit + 53 integration tests passing (details below) |
| 9. Final verification | 🟡 | Local production-mode checks done; Railway / SMTP / Claude / domain pending |

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Runs on a supported Node.js version | 🟡 | Dockerfile `node:24-alpine`; `engines: >=22`. Tests ran on Node 22.23 locally; the Node 24 image itself was not built (disk) |
| No syntax errors | ✅ | `npm run check:syntax` → 99/99 files (+ test in `npm test`) |
| New PostgreSQL DB is created by migrations | ✅ | `migrations.test.js` (fresh DB, baseline + 34 files) |
| Re-running migrations is safe | ✅ | Re-run no-op; 3 concurrent runners → each file applied once; interrupted run resumed |
| Supports Railway environment variables | ✅ | `DATABASE_URL`, `PORT`, `RAILWAY_RUN_UID`, volume path; guide + `.railway/railway.ts` |
| Listens on `PORT` | ✅ | `server/index.js` uses config `PORT`, default dual-stack host |
| Healthcheck reports ready only when ready | ✅ | `/api/health` checks migrations + DB, 503 otherwise (integration test) |
| Production OTP is not exposed | ✅ | `otp-production.test.js`: no `devCode`, no OTP in logs, 503 without SMTP; prod start blocked with `DEBUG_OTP=1` |
| No known demo credentials in production | ✅ | `db:seed` refuses in production; `demo:seed` uses random/owner passwords, guarded |
| No API keys in frontend | ✅ | `platform.test.js` scans `public/`; Electron bundle excludes `.env` |
| Claude provider integrated | 🟡 ⏳ | `AnthropicProvider` with official SDK, unit-tested request shape; **live call PENDING EXTERNAL VERIFICATION** |
| AI Fitness Assistant uses provider abstraction | ✅ | `server/ai/assistant.js`, mock-provider integration tests |
| AI Booking Assistant uses backend tools | ✅ | `server/ai/tools.js`; end-to-end flow test (search → prepare → confirm) |
| Booking requires real confirmation | ✅ | Server token, single-use, user-bound, TTL; replay → 409, other user → 400, expired → 410 |
| Authorization cannot be bypassed via AI | ✅ | Tools user-scoped; staff/unknown tools refused; extra args (`client_id`) rejected; injection test |
| PWA has a valid service worker | ✅ | Syntax test + browser run without console errors |
| Uploads have a production storage strategy | ✅ | `UPLOADS_DIR` on Railway volume, hardened headers; volume itself ⏳ |
| Cluvyra shown as product brand | ✅ | Landing, cabinets, manifest, SW, emails, AI prompt |
| Landing reachable without auth | ✅ | `/`, `/privacy`, `/terms`, `/app` → 200 (integration test) |
| Critical tests run and documented | ✅ | This file |
| README and deployment guide current | ✅ | `README.md`, `docs/RAILWAY_DEPLOYMENT.md` |

## Test results (local, 2026-10-08)

Environment: macOS, Node v22.23.1, PostgreSQL 16 (Docker, disposable databases), mock AI provider.

```
npm test                    → tests 79 · pass 79 · fail 0
npm run test:integration    → tests 52 · pass 52 · fail 0   (6 files, real PostgreSQL)
  + auth.test.js re-run after adding the early-access test → 15 · pass 15
npm run check:syntax        → 99/99 files OK
npm audit --omit=dev        → found 0 vulnerabilities
```

Integration coverage:

* **migrations** — fresh DB, idempotent re-run, concurrency, schema contents, verify mode.
* **auth** — health/headers, public pages, register → verify → login, weak password / invalid email, uniform login errors, missing/forged/`alg=none` tokens, role restrictions, client payments blocked, payment validation, password change revokes tokens, trainer IDOR, JSON 404/400 without stack traces, mandatory staff 2FA, public config & early-access form.
* **otp-production** — 503 without SMTP, no codes in API or logs, HSTS.
* **booking** — available slot, duplicate, full class, no/expired subscription, subscription ends before class, wrong access type, past/inactive class, horizon, cancellation & re-booking, foreign cancellation, **8 concurrent requests for the last seat → exactly 1 booking**, concurrent single-visit pass, invalid ids.
* **ai** — auth, history validation, plain answer & context, missing key → 503, provider timeout → 503 + usage record, full booking flow, foreign token, expired/declined token, capacity re-check at confirm, tool-argument validation, unauthorized tools, prompt injection, bounded tool rounds, own-data-only tools, refusal handling, usage metrics.

Additional manual verification:

* Browser (in-app + headless Chrome): landing desktop/mobile, early-access form submit, client/admin/manager cabinets in the new theme, AI chat cards → **real** `prepare`/`confirm` endpoints → booking row in PostgreSQL (only the LLM reply was stubbed).
* Production mode: unsafe config refused with explicit reasons; `npm run db:migrate` reports connection errors clearly.

Not run:

* ❌ Real Claude API request (no `ANTHROPIC_API_KEY`; intentionally no spend).
* ❌ Docker image build — local disk filled up to 100% during `docker build` and Docker Desktop became unresponsive; re-run on a machine with free space or let Railway build it.
* ❌ Real SMTP delivery, Railway deploy, custom domain, Web Push with real VAPID keys.

## Re-audit 2026-10-13 (cloud session)

Re-verified from `feature/cluvyra-startup` @ `d94c8c4`:

| Check | Result |
|---|---|
| `npm ci` / `npm run check:syntax` | ✅ 100/100 files |
| `npm test` | ✅ 79/79 |
| `npm run test:integration` (disposable PostgreSQL 16, Node 22.22) | ✅ 53/53 |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Docker build | ❌ **blocked**: Docker Hub returned `429 Too Many Requests` pulling `node:24-alpine` (sandbox rate limit). Still unverified — retry elsewhere or let Railway build |
| Railway (project, variables, logs, health, domain) | ⏳ **not verified** — no Railway CLI/token/MCP in this session; `.railway/railway.ts` not compared with live config; do **not** `railway config apply` before `railway config plan` |
| Live Claude API / tool calling / token usage | ⏳ **not verified** — no `ANTHROPIC_API_KEY` available in this session (keys live only in Railway); $0 spent |
| Browser E2E | not re-run in this session |

Changes made in this session:

* Default `ANTHROPIC_MODEL` changed from `claude-opus-5-5` to the cheaper `claude-sonnet-5-5` (still overridable in Railway; `claude-haiku-5-5` is the lowest-cost option — unverified for effort/fallback params, so it uses the plain request path).
* Demo-request form: repeat submissions with the same email within 24 h no longer create duplicates (`200 {duplicate:true}`); owner email notification via SMTP to `SUPPORT_EMAIL` when both are configured (best effort, header-injection safe). Covered by the auth integration test.
* New `docs/DEMO_SCRIPT.md`; `docs/STARTUP_APPLICATION.md` refreshed against the live program page (capacity notice, origin statement, status separation, roadmap).
* Privacy/Terms still contain intentional "Owner to confirm" placeholders (legal entity, region, retention) — owner input required.

## Environment limitations encountered

* Host disk had ~0 bytes free after the Docker build attempt; temporary screenshots were deleted to recover. Docker Desktop (shared with another local project) is hung and needs a restart by the owner. Free disk space before running `docker build` again.

## External steps (owner)

See [`RAILWAY_DEPLOYMENT.md`](RAILWAY_DEPLOYMENT.md) and [`STARTUP_APPLICATION.md`](STARTUP_APPLICATION.md):
Railway project + PostgreSQL + volume, variables, Anthropic key, SMTP, demo seed, domain + mailbox,
legal review, application submission.

## Remaining work / known gaps

* Cabinets UI is Ukrainian only (landing is English).
* JWT in `localStorage` (cookie sessions planned).
* Single-organisation data model.
* `POST /api/subscriptions/purchase` activates memberships without a payment provider (documented).
* Uploaded photos committed upstream remain in Git history (history rewrite requires owner decision).
* Brand layer overrides the old theme via CSS; a full design-system refactor of the cabinet CSS is future work.
