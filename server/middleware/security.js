/**
 * HTTP security headers.
 *
 * The frontend stores the JWT in localStorage, so XSS would mean account
 * takeover. The Content-Security-Policy below is the main mitigation:
 *  • scripts only from our origin (inline allowed because existing pages use
 *    small inline bootstrap scripts for the theme);
 *  • fetch/XHR/SSE only to our origin — injected code cannot exfiltrate the
 *    token to a third-party host;
 *  • no plugins, no <base> hijacking, no framing (clickjacking).
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  // Notification chime is generated in memory as a blob: WAV.
  "media-src 'self' blob: data:",
  "connect-src 'self'",
  // Club contacts page embeds a Google map.
  'frame-src https://www.google.com',
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * @param {{ isProduction: boolean }} options
 * @returns {import('express').RequestHandler}
 */
export function securityHeaders({ isProduction }) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Content-Security-Policy', CSP);
    if (isProduction) {
      // Railway terminates TLS at its edge; the app is only reachable via HTTPS.
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}

/**
 * Extra hardening for user-uploaded files: even if a file somehow contained
 * markup, the browser must treat it as an inert image.
 *
 * @type {import('express').RequestHandler}
 */
export function uploadHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

/** API responses contain personal data and must never be cached by browsers or proxies. */
export function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
