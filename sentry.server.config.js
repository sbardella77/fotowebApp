import * as Sentry from '@sentry/nextjs'

// No-ops safely if SENTRY_DSN is unset (init() just skips sending events) —
// this SDK is meant to work the moment a DSN is added to env vars, without
// any other code change.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Keep PII out by default — ops-alerts/safe-log already have their own
  // redaction conventions for anything we deliberately attach to events.
  sendDefaultPii: false,
})
