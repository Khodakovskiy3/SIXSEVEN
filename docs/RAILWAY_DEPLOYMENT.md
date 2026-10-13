# Deploying Cluvyra to Railway

Target topology (single instance):

```
Railway project "cluvyra"
 ├─ cluvyra-web    (this repo, Dockerfile, Node 24)  ── volume "cluvyra-uploads" at /data
 └─ Postgres       (Railway-managed PostgreSQL)
```

> These steps were prepared without access to a Railway account. Dashboard labels can change —
> if a menu differs, look for the same setting name in the service **Settings** tab.
> Nothing here requires a paid add-on beyond Railway’s normal usage-based billing; check current
> pricing before creating services.

Infrastructure as Code: [`.railway/railway.ts`](../.railway/railway.ts) describes the same setup
(Railway’s replacement for the deprecated `railway.json` / `railway.toml`, cut-off 2026-12-01).
You can either follow the dashboard steps below **or** run `railway config plan` / `railway config apply`
(section 0). Do not mix both for the same service. The IaC file has **not** been applied to a live
project yet — always run `plan` first and review the diff.

---

## 0. (Optional) Apply Infrastructure as Code

```bash
npm install --no-save railway      # Railway CLI with the railway/iac DSL
npx railway login
npx railway link                   # select/create the "cluvyra" project
npx railway config plan            # shows what would change, changes nothing
npx railway config apply           # applies after confirmation
```

Then set the secret variables (section 5) in the dashboard — the IaC file uses `preserve()` for them.

## 1. Create the Railway project

1. Sign in at railway.com → **New Project** → **Empty project**. Name it `cluvyra`.

## 2. Connect the GitHub repository

1. In the project: **Create → GitHub Repo** → authorise Railway for `Khodakovskiy3/SIXSEVEN`.
2. Select the branch to deploy (`main` after merging `feature/cluvyra-startup`, or the feature branch for a preview).
3. Rename the service to `cluvyra-web`. Railway detects the root `Dockerfile` and builds it.

## 3. Create PostgreSQL

1. **Create → Database → PostgreSQL**. Railway provisions it and exposes `DATABASE_URL`.
2. Keep the database private (no public TCP proxy) unless you need external access for backups.

## 4. Pass `DATABASE_URL` to the app

In `cluvyra-web` → **Variables** → **New Variable**:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

(`Postgres` is the database service name; adjust if you renamed it.) This uses Railway’s private
network — `DATABASE_SSL` can stay `false`. If you ever connect through the public proxy URL, set
`DATABASE_SSL=true`.

## 5. Environment variables

Set in `cluvyra-web` → **Variables** (use **Raw Editor** to paste):

```
NODE_ENV=production
RUN_MIGRATIONS_ON_START=false
JOBS_ENABLED=true
APP_TIMEZONE=Europe/Kyiv
PRODUCT_NAME=Cluvyra
ORGANIZATION_NAME=OLIMP Demo
APP_URL=https://<your-service>.up.railway.app
PUBLIC_SITE_URL=https://<your-service>.up.railway.app
SUPPORT_EMAIL=
JWT_SECRET=<openssl rand -hex 32>
DEBUG_OTP=0
UPLOADS_DIR=/data/uploads
RAILWAY_RUN_UID=0
AI_ENABLED=true
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<from Claude Console>
ANTHROPIC_MODEL=claude-sonnet-5-5
ANTHROPIC_EFFORT=low
DEMO_MODE=false
```

* The app **refuses to start** in production with a missing/weak `JWT_SECRET`, `DEBUG_OTP=1`, missing
  database settings, or `AI_ENABLED=true` without `ANTHROPIC_API_KEY`. Read the deploy logs for the exact message.
* Do not set `PORT` — Railway injects it and the server listens on it.
* `RAILWAY_RUN_UID=0` is needed because Railway mounts volumes as root while the image runs as the
  non-root `node` user.
* Leave `SUPPORT_EMAIL` empty until `hello@cluvyra.com` (or another mailbox) really exists.

## 6. Anthropic API key

1. Create an account at the Claude Console (platform.claude.com), set up billing or credits.
2. **API keys → Create key**, name it `cluvyra-production`, copy it once.
3. Paste it as `ANTHROPIC_API_KEY` in Railway Variables (never in the repo, frontend or Electron).
4. Recommended: set a monthly spend limit in the Console. App-side limits: `AI_REQUESTS_PER_MINUTE`,
   `AI_DAILY_REQUEST_LIMIT`, `AI_MAX_TOKENS`, `AI_MAX_TOOL_ROUNDS`.
5. Without a key yet: set `AI_ENABLED=false` — everything else works and the chat shows “AI unavailable”.

## 7. SMTP (email codes)

Registration and admin/manager sign-in (mandatory 2FA) need email delivery. Without SMTP those
endpoints return **503** — codes are never exposed. Any SMTP provider works (e.g. a transactional
email service; a Gmail account with an app password is fine for a demo).

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587          # 465 = implicit TLS
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=Cluvyra <no-reply@your-domain>
```

After buying `cluvyra.com`, configure SPF/DKIM for the sending domain at your email provider.

## 8. Persistent uploads (volume)

1. `cluvyra-web` → right-click / **Settings** → **Volumes** → **Add Volume**, mount path `/data`.
2. Ensure `UPLOADS_DIR=/data/uploads` and `RAILWAY_RUN_UID=0` are set.
3. Images uploaded by admins are served at `/assets/uploads/<random>.jpg` and survive redeploys.
   A volume attaches to one instance — keep `replicas = 1`.

## 9. Migrations

* **Settings → Deploy → Pre-Deploy Command:** `npm run db:migrate`
* With `RUN_MIGRATIONS_ON_START=false` the server only verifies that all migrations are applied and
  exits with a clear error otherwise.
* The runner is idempotent and lock-protected: repeat deploys and parallel runs are safe. On an empty
  Railway database it creates the full schema from `db/schema.sql` + all migrations automatically.

### Existing database (migrating an old OLIMP deployment)

1. Take a backup first (section 18).
2. Point `DATABASE_URL` to the existing database and run `npm run db:migrate` once (locally with the
   public URL, or as the pre-deploy command).
3. The runner detects “tables exist but no `schema_migrations`”, re-applies the historical
   idempotent migrations once, records them, then applies new ones (`033_cluvyra_platform`,
   `034_early_access_requests`). No tables or rows are deleted.
4. `033` adds `users.token_version`. Existing sessions stay valid: tokens issued before the upgrade
   carry no `tv` claim, which is treated as version `0`.

## 10. Healthcheck

**Settings → Deploy → Healthcheck Path:** `/api/health` (timeout e.g. 120 s).
It returns `200 {"status":"ready"}` only when migrations are verified and PostgreSQL answers;
otherwise `503`. `/api/health/live` is a plain liveness probe.

## 11. Public Railway domain

**Settings → Networking → Generate Domain** → `https://<name>.up.railway.app`.
Update `APP_URL` and `PUBLIC_SITE_URL` to this URL and redeploy.

## 12. Custom domain (later)

After buying the domain:
1. **Settings → Networking → Custom Domain** → `app.cluvyra.com` (app) — and optionally `cluvyra.com`
   for the landing (the same service serves both today).
2. Create the DNS records Railway shows (CNAME for subdomains; for the apex use your DNS provider’s
   ALIAS/ANAME/CNAME-flattening, or point `cluvyra.com` → redirect to `app.cluvyra.com`).
3. Wait for the certificate, then set `APP_URL=https://app.cluvyra.com`,
   `PUBLIC_SITE_URL=https://cluvyra.com` and redeploy.

## 13. Verify sign-in

1. Create demo data once (synthetic only):
   `railway run --service cluvyra-web npm run demo:seed -- --confirm` with `DEMO_MODE=true` set
   temporarily. Passwords are printed **once** in your terminal (or taken from
   `DEMO_*_PASSWORD` variables). Set `DEMO_ADMIN_EMAIL` / `DEMO_MANAGER_EMAIL` to real mailboxes so
   staff 2FA codes arrive. Then set `DEMO_MODE=false`.
2. Open `/app`, sign in as the demo client (no 2FA) → client dashboard.
3. Sign in as admin → a 2FA code arrives by email → admin dashboard.
4. Wrong password 20× from one IP → `429` (rate limit works).

## 14. Verify AI

1. As the demo client open the chat bubble → **AI-асистент**.
2. Ask: “Як правильно розминатися перед HIIT?” → a short answer.
3. `GET /api/ai/status` (signed in) → `{"available": true}`.
4. As manager: `GET /api/ai/usage` → token/latency metrics without message text.

## 15. Verify booking

1. In the AI tab: “Хочу завтра після 18:00 на групове тренування”.
2. Cards with real classes appear → **Обрати** → confirmation card → **Підтвердити**.
3. “✓ Заброньовано” appears only after the server returns 201; the booking is visible in
   **Записи** and in the admin schedule; the class seat count decreases.
4. Ask the same again → the slot shows “Ви записані”.

## 16. Logs

* Dashboard: `cluvyra-web` → **Deployments** → select a deployment → **View logs** (build, deploy, HTTP).
* CLI: `railway logs --service cluvyra-web`.
* Logs contain error stacks and request paths, never OTP codes, passwords, tokens or AI message text.

## 17. Safe rollback

* **Code:** Deployments → pick the last good deployment → **Redeploy/Rollback**.
* **Database:** migrations are additive. A rollback of code does **not** roll back the schema; older
  code ignores new tables/columns. Never drop tables to “undo” a migration — restore from backup if
  data must be reverted.
* Keep the previous deployment until the new one passes `/api/health`.

## 18. PostgreSQL backups

* Railway: check the database service’s **Backups** tab (scheduled volume backups, if available on
  your plan) and enable a daily schedule.
* Manual logical backup (recommended before every migration of real data):

```bash
# temporarily enable the Postgres TCP proxy or use `railway connect`, then:
pg_dump "$DATABASE_PUBLIC_URL" --format=custom --no-owner --file=cluvyra-$(date +%F).dump
# restore into an EMPTY database:
pg_restore --no-owner --dbname "$TARGET_DATABASE_URL" cluvyra-YYYY-MM-DD.dump
```

Store dumps encrypted, outside the repository.

---

## Single-instance limitations

Rate limits, SSE chat tickets and the AI per-minute limiter are in memory; background jobs use
PostgreSQL advisory locks (safe if a second instance appears, but `JOBS_ENABLED` should stay `true`
on one instance only). Scale to multiple replicas only after moving these to Redis and uploads to
object storage.
