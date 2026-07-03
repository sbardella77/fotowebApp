/**
 * SnapRooms — operational alerting helper.
 *
 * Sends email alerts to the ops team for business-critical or payment-critical
 * events. Safe to call from webhooks and API routes: failures are caught and
 * logged, and the helper never throws.
 *
 * Environment variables:
 *   OPS_ALERT_EMAIL      — destination address for ops alerts
 *   RESEND_API_KEY       — Resend API key
 *   RESEND_FROM_EMAIL    — verified sender address
 *
 * If any of the above is missing, the alert is logged to stdout/stderr and the
 * email is skipped.
 */

import { Resend } from 'resend'

const SENSITIVE_KEY_SUBSTRINGS = [
  'password',
  'token',
  'cookie',
  'secret',
  'apikey',
  'authorization',
  'card',
  'cvc',
  'cvv',
  'number',
  'stripe',
  'raw',
]

function getResendClient() {
  if (!process.env.RESEND_API_KEY) return null
  if (!globalThis.__snaproomsResendClient) {
    globalThis.__snaproomsResendClient = new Resend(process.env.RESEND_API_KEY)
  }
  return globalThis.__snaproomsResendClient
}

function getFromEmail() {
  return process.env.RESEND_FROM_EMAIL || null
}

function isSensitiveKey(key) {
  if (typeof key !== 'string') return true
  const lower = key.toLowerCase()
  return SENSITIVE_KEY_SUBSTRINGS.some((sub) => lower.includes(sub))
}

/**
 * Recursively remove sensitive fields and deeply nested raw objects.
 * Only plain objects are sanitized; arrays of IDs/primitives are kept.
 */
function sanitizeContext(context, depth = 0) {
  if (depth > 3) return '[max-depth]'
  if (context === null || context === undefined) return null
  if (typeof context !== 'object') return context
  if (Array.isArray(context)) {
    return context.slice(0, 20).map((item) => sanitizeContext(item, depth + 1))
  }

  const sanitized = {}
  for (const [key, value] of Object.entries(context)) {
    if (isSensitiveKey(key)) continue
    sanitized[key] = sanitizeContext(value, depth + 1)
  }
  return sanitized
}

function buildText({ severity, type, title, message, context, appUrl }) {
  const lines = [
    `SnapRooms Ops Alert — ${severity.toUpperCase()}`,
    `Type: ${type}`,
    `Title: ${title}`,
    message ? `Message: ${message}` : null,
    `App: ${appUrl}`,
    `Time: ${new Date().toISOString()}`,
    context && Object.keys(context).length > 0 ? `Context:\n${JSON.stringify(context, null, 2)}` : null,
  ]
  return lines.filter(Boolean).join('\n\n')
}

function buildHtml({ severity, type, title, message, context, appUrl }) {
  const color = severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#d97706' : '#2563eb'
  const contextHtml =
    context && Object.keys(context).length > 0
      ? `<pre style="background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto;font-size:12px;">${JSON.stringify(context, null, 2)}</pre>`
      : '<p><em>No additional context.</em></p>'

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>SnapRooms Ops Alert</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;color:#1f1f1f;background:#f8f6f1;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <h1 style="color:${color};font-size:20px;margin-top:0;">SnapRooms ${severity.toUpperCase()} Alert</h1>
    <p style="font-size:14px;color:#6b7280;">Type: <code>${type}</code></p>
    <h2 style="font-size:18px;margin-top:24px;">${title}</h2>
    ${message ? `<p style="font-size:15px;line-height:1.5;">${message}</p>` : ''}
    <p style="font-size:13px;color:#6b7280;">App: ${appUrl}<br>Time: ${new Date().toISOString()}</p>
    <h3 style="font-size:14px;margin-top:24px;">Context</h3>
    ${contextHtml}
  </div>
</body>
</html>
  `.trim()
}

/**
 * Send an operational alert.
 *
 * @param {Object} params
 * @param {'critical'|'warning'|'info'} params.severity
 * @param {string} params.type — machine-readable alert category (e.g. 'billing:webhook:fulfillment_failed')
 * @param {string} params.title — short human-readable title
 * @param {string} [params.message] — longer description
 * @param {Object} [params.context] — safe IDs and metadata (sensitive fields are stripped)
 * @returns {Promise<{sent: boolean, id?: string, reason?: string, error?: string}>}
 */
export async function sendOpsAlert({ severity = 'warning', type, title, message, context = {} }) {
  const to = process.env.OPS_ALERT_EMAIL
  const fromEmail = getFromEmail()
  const resend = getResendClient()
  const appUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app'

  const safeContext = sanitizeContext(context)
  const logPayload = { type, title, message, ...safeContext }

  // Always log the alert so it appears in Vercel/Logtail even if email is off.
  if (severity === 'critical') {
    console.error(`[ops-alert:${severity}:${type}]`, logPayload)
  } else {
    console.warn(`[ops-alert:${severity}:${type}]`, logPayload)
  }

  if (!to) {
    console.warn(`[ops-alert:${severity}:${type}] OPS_ALERT_EMAIL not configured, skipping email alert`)
    return { sent: false, reason: 'ops_alert_email_missing' }
  }

  if (!resend || !fromEmail) {
    console.warn(`[ops-alert:${severity}:${type}] Resend not configured, skipping email alert`)
    return { sent: false, reason: 'resend_not_configured' }
  }

  try {
    const result = await resend.emails.send({
      from: fromEmail,
      to,
      subject: `[SnapRooms ${severity.toUpperCase()}] ${title}`,
      text: buildText({ severity, type, title, message, context: safeContext, appUrl }),
      html: buildHtml({ severity, type, title, message, context: safeContext, appUrl }),
    })

    console.log(`[ops-alert:${severity}:${type}] Alert email sent`, { id: result?.data?.id })
    return { sent: true, id: result?.data?.id }
  } catch (error) {
    console.error(`[ops-alert:${severity}:${type}] Failed to send alert email`, { error: error.message })
    return { sent: false, reason: 'send_error', error: error.message }
  }
}
