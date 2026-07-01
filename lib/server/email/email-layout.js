/**
 * SnapRooms — shared transactional email layout.
 *
 * Pure helper: no DB, no Resend client. Builds text + HTML from safe inputs.
 */

export const EMAIL_DEFAULT_LOCALE = 'de'
export const EMAIL_SUPPORTED_LOCALES = ['de', 'en', 'it']

const BRAND_GOLD = '#d4a853'
const BRAND_TEXT = '#111111'
const BRAND_MUTED = '#4b5563'
const BRAND_FAINT = '#9ca3af'

const COMMON = {
  de: {
    brand: 'SnapRooms',
    tagline: 'Every guest photo. One room.',
    privacy: 'Datenschutz',
    support: 'Support',
    fallbackFooter: 'SnapRooms — Every guest photo. One room.',
  },
  en: {
    brand: 'SnapRooms',
    tagline: 'Every guest photo. One room.',
    privacy: 'Privacy',
    support: 'Support',
    fallbackFooter: 'SnapRooms — Every guest photo. One room.',
  },
  it: {
    brand: 'SnapRooms',
    tagline: 'Every guest photo. One room.',
    privacy: 'Privacy',
    support: 'Supporto',
    fallbackFooter: 'SnapRooms — Every guest photo. One room.',
  },
}

function resolveLocale(locale) {
  const normalized = typeof locale === 'string' ? locale.split('-')[0].toLowerCase() : ''
  if (EMAIL_SUPPORTED_LOCALES.includes(normalized)) return normalized
  return EMAIL_DEFAULT_LOCALE
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paragraphsToHtml(lines) {
  return lines
    .map((line) => {
      const withBreaks = escapeHtml(line).replace(/\n/g, '<br>')
      return `<p style="margin:0 0 16px;color:${BRAND_MUTED};">${withBreaks}</p>`
    })
    .join('')
}

function ctaToHtml(cta) {
  if (!cta?.text || !cta?.url) return ''
  return `
    <p style="margin:24px 0;text-align:center;">
      <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 24px;background:${BRAND_GOLD};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
        ${escapeHtml(cta.text)}
      </a>
    </p>`
}

/**
 * Build a transactional email with consistent SnapRooms branding.
 *
 * @param {Object} params
 * @param {string} params.subject — Email subject
 * @param {string} [params.preview] — Preview text (preheader)
 * @param {string} params.headline — Main heading
 * @param {string[]} params.bodyLines — Paragraphs of body text
 * @param {{text:string,url:string}} [params.cta] — Call-to-action button
 * @param {string} [params.footer] — Custom footer line
 * @param {string} [params.locale='de'] — Content locale
 * @param {string} params.appUrl — Application base URL
 * @returns {{subject:string, text:string, html:string}}
 */
export function buildEmail({
  subject,
  preview,
  headline,
  bodyLines = [],
  cta = null,
  footer = null,
  locale = EMAIL_DEFAULT_LOCALE,
  appUrl,
}) {
  const l = resolveLocale(locale)
  const strings = COMMON[l]
  const privacyUrl = `${appUrl.replace(/\/$/, '')}/privacy`
  const supportEmail = 'hello@snaprooms.app'

  const safePreview = preview || headline
  const safeHeadline = headline
  const safeBody = bodyLines.filter(Boolean)
  const safeFooter = footer || strings.fallbackFooter

  // Plain text version
  const textParts = [
    safeHeadline,
    '',
    ...safeBody,
    '',
    cta ? `${cta.text}: ${cta.url}` : null,
    '',
    safeFooter,
    '',
    `${strings.privacy}: ${privacyUrl}`,
    `${strings.support}: ${supportEmail}`,
  ].filter(Boolean)

  const text = textParts.join('\n')

  // HTML version
  const html = `<!DOCTYPE html>
<html lang="${l}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(safePreview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:${BRAND_TEXT};border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;">
            <span style="font-size:20px;font-weight:700;color:${BRAND_GOLD};letter-spacing:-0.5px;">${escapeHtml(strings.brand)}</span>
          </div>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;text-align:center;">${escapeHtml(safeHeadline)}</h1>
          ${paragraphsToHtml(safeBody)}
          ${ctaToHtml(cta)}
          <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:${BRAND_FAINT};">
            ${escapeHtml(safeFooter)}<br>
            <a href="${escapeHtml(privacyUrl)}" style="color:${BRAND_FAINT};text-decoration:underline;">${escapeHtml(strings.privacy)}</a> ·
            <a href="mailto:${escapeHtml(supportEmail)}" style="color:${BRAND_FAINT};text-decoration:underline;">${escapeHtml(strings.support)}</a>
          </p>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, text, html }
}
