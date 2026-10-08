/**
 * Railway Infrastructure as Code for Cluvyra.
 *
 * Replaces the deprecated railway.json / railway.toml config-as-code.
 * Review and apply with the Railway CLI (see docs/RAILWAY_DEPLOYMENT.md):
 *
 *   npm install --no-save railway
 *   railway login && railway link
 *   railway config plan     # shows the diff, changes nothing
 *   railway config apply    # applies after confirmation
 *
 * Secrets are never stored here: preserve() keeps the value set in the
 * Railway dashboard (Variables tab) untouched.
 *
 * NOTE: written against docs.railway.com/infrastructure-as-code/reference
 * (2026-10). Not yet applied to a live project — run `railway config plan`
 * first and compare with the dashboard checklist in the deployment guide.
 */
import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("postgres");

  const uploads = volume("cluvyra-uploads", { sizeMB: 1024 });

  const web = service("cluvyra-web", {
    // Built from the repository Dockerfile (Node 24 + Python/reportlab).
    // Switch to "main" after merging feature/cluvyra-startup.
    source: github("Khodakovskiy3/SIXSEVEN", { branch: "feature/cluvyra-startup" }),
    // Migrations run once per deploy before traffic switches; the runner is
    // idempotent and guarded by a PostgreSQL advisory lock.
    preDeploy: "npm run db:migrate",
    start: "node server/index.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    // Single instance: in-memory rate limits, SSE tickets and the in-process
    // scheduler assume one replica (see docs/AUDIT.md).
    replicas: 1,
    volumeMounts: { "/data": uploads },
    env: {
      NODE_ENV: "production",
      // Railway volumes are mounted as root; the image runs as the non-root
      // "node" user, so the container must start with UID 0 to write /data.
      RAILWAY_RUN_UID: "0",
      DATABASE_URL: db.env.DATABASE_URL,
      RUN_MIGRATIONS_ON_START: "false",
      UPLOADS_DIR: "/data/uploads",
      APP_TIMEZONE: "Europe/Kyiv",
      PRODUCT_NAME: "Cluvyra",
      ORGANIZATION_NAME: "OLIMP Demo",
      APP_URL: preserve(),
      PUBLIC_SITE_URL: preserve(),
      SUPPORT_EMAIL: preserve(),
      JWT_SECRET: preserve(),
      DEBUG_OTP: "0",
      SMTP_HOST: preserve(),
      SMTP_PORT: preserve(),
      SMTP_USER: preserve(),
      SMTP_PASS: preserve(),
      SMTP_FROM: preserve(),
      AI_ENABLED: preserve(),
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: preserve(),
      ANTHROPIC_MODEL: preserve(),
      DEMO_MODE: preserve(),
    },
  });

  return project("cluvyra", {
    resources: [db, uploads, web],
  });
});
