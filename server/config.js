/**
 * Centralised runtime configuration for Cluvyra.
 *
 * Every environment variable the server reads is parsed here once, so the
 * rest of the code never touches `process.env` directly. `validateConfig()`
 * is called at startup and refuses to boot a production process with an
 * unsafe configuration (missing secrets, debug switches left on) instead of
 * silently falling back to insecure defaults.
 */

import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const env = process.env;

/** Parses boolean-ish env values ("true", "1", "yes", "on"). */
function bool(value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/** Parses a positive integer, falling back when the value is missing or invalid. */
function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function str(value, fallback = '') {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

function list(value) {
  return str(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const NODE_ENV = str(env.NODE_ENV, 'development');
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

/** Default Claude model; override with ANTHROPIC_MODEL (see docs). */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

export const config = Object.freeze({
  env: NODE_ENV,
  isProduction,
  isTest,

  server: Object.freeze({
    port: int(env.PORT, 3000),
    // Empty host = Node default (dual-stack "::"), which works for Railway
    // public and private networking.
    host: str(env.HOST),
    trustProxyHops: int(env.TRUST_PROXY_HOPS, 1),
    corsOrigins: list(env.CORS_ORIGIN),
    runMigrationsOnStart: bool(env.RUN_MIGRATIONS_ON_START, true),
    jobsEnabled: bool(env.JOBS_ENABLED, !isTest),
  }),

  brand: Object.freeze({
    productName: str(env.PRODUCT_NAME, 'Cluvyra'),
    tagline: 'Run your studio. Simplify every booking.',
    organizationName: str(env.ORGANIZATION_NAME, 'OLIMP Demo'),
    appUrl: str(env.APP_URL, `http://localhost:${int(env.PORT, 3000)}`),
    publicSiteUrl: str(env.PUBLIC_SITE_URL, str(env.APP_URL, `http://localhost:${int(env.PORT, 3000)}`)),
    supportEmail: str(env.SUPPORT_EMAIL),
  }),

  timezone: str(env.APP_TIMEZONE, 'Europe/Kyiv'),

  db: Object.freeze({
    url: str(env.DATABASE_URL),
    hasExplicitHost: Boolean(str(env.PGHOST)),
    host: str(env.PGHOST, 'localhost'),
    port: int(env.PGPORT, 5432),
    database: str(env.PGDATABASE, 'sports_club_db'),
    user: str(env.PGUSER, 'postgres'),
    password: env.PGPASSWORD || undefined,
    ssl: bool(env.DATABASE_SSL, false),
    sslRejectUnauthorized: bool(env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    poolMax: int(env.DB_POOL_MAX, 10),
    connectTimeoutMs: int(env.DB_CONNECT_TIMEOUT_MS, 10_000),
    statementTimeoutMs: int(env.DB_STATEMENT_TIMEOUT_MS, 30_000),
  }),

  auth: Object.freeze({
    jwtSecret: env.JWT_SECRET || '',
    jwtTtl: str(env.JWT_TTL, '7d'),
  }),

  mail: Object.freeze({
    host: str(env.SMTP_HOST),
    port: int(env.SMTP_PORT, 587),
    user: str(env.SMTP_USER),
    pass: env.SMTP_PASS || '',
    from: str(env.SMTP_FROM),
    // DEBUG_OTP=1: only honoured outside production (validateConfig blocks it there).
    debugOtp: env.DEBUG_OTP === '1',
  }),

  uploads: Object.freeze({
    // Railway: mount a volume and set UPLOADS_DIR=/data/uploads.
    dir: str(env.UPLOADS_DIR),
    maxBytes: int(env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
  }),

  logging: Object.freeze({
    dir: str(env.LOG_DIR),
  }),

  push: Object.freeze({
    vapidPublicKey: str(env.VAPID_PUBLIC_KEY),
    vapidPrivateKey: str(env.VAPID_PRIVATE_KEY),
    vapidSubject: str(env.VAPID_SUBJECT, env.SUPPORT_EMAIL ? `mailto:${str(env.SUPPORT_EMAIL)}` : 'mailto:admin@example.com'),
  }),

  ai: Object.freeze({
    enabled: bool(env.AI_ENABLED, true),
    provider: str(env.AI_PROVIDER, 'anthropic').toLowerCase(),
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    anthropicModel: str(env.ANTHROPIC_MODEL, DEFAULT_ANTHROPIC_MODEL),
    // Opus 5.5 always thinks; effort is the cost/latency control. "low" suits chat.
    anthropicEffort: str(env.ANTHROPIC_EFFORT, 'low'),
    refusalFallback: bool(env.ANTHROPIC_REFUSAL_FALLBACK, true),
    ollamaUrl: str(env.OLLAMA_URL, 'http://localhost:11434'),
    ollamaModel: str(env.OLLAMA_MODEL, 'qwen3:8b'),
    maxTokens: int(env.AI_MAX_TOKENS, 4096),
    timeoutMs: int(env.AI_TIMEOUT_MS, 45_000),
    maxRetries: Number.isFinite(Number(env.AI_MAX_RETRIES)) && env.AI_MAX_RETRIES !== ''
      ? Math.max(0, Math.min(5, Number(env.AI_MAX_RETRIES)))
      : 2,
    maxToolRounds: int(env.AI_MAX_TOOL_ROUNDS, 6),
    historyLimit: int(env.AI_HISTORY_LIMIT, 16),
    maxMessageChars: int(env.AI_MAX_MESSAGE_CHARS, 2000),
    requestsPerMinute: int(env.AI_REQUESTS_PER_MINUTE, 6),
    dailyRequestLimit: int(env.AI_DAILY_REQUEST_LIMIT, 60),
    bookingTokenTtlMin: int(env.AI_BOOKING_TOKEN_TTL_MIN, 10),
    bookingHorizonDays: int(env.BOOKING_HORIZON_DAYS, 60),
  }),

  demo: Object.freeze({
    enabled: bool(env.DEMO_MODE, false),
  }),
});

/** Placeholder secrets that must never reach production. */
const INSECURE_SECRETS = new Set([
  'change_me',
  'change_me_to_a_long_random_string',
  'secret',
  'changeme',
]);

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Collects configuration problems. Errors block a production start; warnings
 * are printed once at boot.
 *
 * @param {typeof config} cfg
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkConfig(cfg = config) {
  const errors = [];
  const warnings = [];

  const secret = cfg.auth.jwtSecret;
  const weakSecret = !secret
    || INSECURE_SECRETS.has(secret)
    || secret.length < MIN_JWT_SECRET_LENGTH;

  if (weakSecret) {
    (cfg.isProduction ? errors : warnings).push(
      `JWT_SECRET is missing or weak (need at least ${MIN_JWT_SECRET_LENGTH} random characters; generate with: openssl rand -hex 32).`
    );
  }

  if (cfg.isProduction && !cfg.db.url && !cfg.db.hasExplicitHost) {
    errors.push('DATABASE_URL is not set (Railway: reference ${{Postgres.DATABASE_URL}}).');
  }

  if (cfg.isProduction && cfg.mail.debugOtp) {
    errors.push('DEBUG_OTP=1 is not allowed in production (it would expose one-time codes).');
  }

  if (cfg.isProduction && !cfg.mail.host) {
    warnings.push(
      'SMTP is not configured: email codes cannot be delivered. Registration and admin/manager sign-in (mandatory 2FA) will return 503 until SMTP_* is set.'
    );
  }

  if (cfg.isProduction && cfg.mail.host && !cfg.mail.from) {
    errors.push('SMTP_FROM must be set when SMTP_HOST is configured.');
  }

  if (cfg.ai.enabled) {
    if (!['anthropic', 'ollama'].includes(cfg.ai.provider)) {
      errors.push(`AI_PROVIDER must be "anthropic" or "ollama" (got "${cfg.ai.provider}").`);
    } else if (cfg.ai.provider === 'anthropic' && !cfg.ai.anthropicApiKey) {
      (cfg.isProduction ? errors : warnings).push(
        'AI_ENABLED=true with AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty. Set the key or AI_ENABLED=false.'
      );
    } else if (cfg.ai.provider === 'ollama' && cfg.isProduction) {
      warnings.push('AI_PROVIDER=ollama in production: make sure OLLAMA_URL is reachable from the server.');
    }
  }

  if (cfg.isProduction && !cfg.uploads.dir) {
    warnings.push(
      'UPLOADS_DIR is not set: uploaded images are stored inside the container and are lost on redeploy. Mount a Railway volume and set UPLOADS_DIR.'
    );
  }

  return { errors, warnings };
}

/**
 * Validates configuration at startup. Throws in production on errors.
 */
export function validateConfig(cfg = config) {
  const { errors, warnings } = checkConfig(cfg);
  for (const warning of warnings) {
    console.warn(`[config] WARNING: ${warning}`);
  }
  if (errors.length > 0) {
    const message = `Refusing to start with unsafe configuration:\n - ${errors.join('\n - ')}`;
    if (cfg.isProduction) {
      throw new Error(message);
    }
    console.warn(`[config] ${message}`);
  }
}

/** Public, non-sensitive subset exposed to the browser. */
export function publicConfig() {
  return {
    productName: config.brand.productName,
    tagline: config.brand.tagline,
    organizationName: config.brand.organizationName,
    appUrl: config.brand.appUrl,
    publicSiteUrl: config.brand.publicSiteUrl,
    supportEmail: config.brand.supportEmail || null,
    timezone: config.timezone,
    aiEnabled: config.ai.enabled,
    demoMode: config.demo.enabled,
  };
}

export default config;
