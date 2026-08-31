/**
 * SnapRooms — shared transactional email layout.
 *
 * Pure helper: no DB, no Resend client. Builds text + HTML from safe inputs.
 */

export const EMAIL_DEFAULT_LOCALE = 'de'
export const EMAIL_SUPPORTED_LOCALES = ['de', 'en', 'it']

const BRAND_LIME = '#DDFB25'
const BRAND_LIME_DARK = '#C8E020'
const BRAND_TEXT = '#1F1F1F'
const BRAND_MUTED = '#5F5A52'
const BRAND_FAINT = '#9A958C'
const BRAND_BG = '#F8F6F1'
const BRAND_CARD = '#FFFFFF'
const BRAND_BORDER = '#D8D0C2'

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
    <p style="margin:28px 0;text-align:center;">
      <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:14px 24px;background-color:${BRAND_LIME};background:linear-gradient(180deg, #F0FF5A 0%, ${BRAND_LIME} 100%);color:${BRAND_TEXT};text-decoration:none;border:1px solid #D6F500;border-radius:14px;font-weight:700;font-size:15px;mso-padding-alt:0;">
        ${escapeHtml(cta.text)}
      </a>
    </p>`
}

// Optional plain-link fallback box — the raw URL as visible, selectable
// text, for the rare case a reader trusts a pasted link more than a button
// (or copies it manually). Opt-in via `linkBox`; no existing caller uses it.
function linkBoxToHtml(linkBox) {
  if (!linkBox?.url) return ''
  return `
    <div style="margin:0 0 24px;padding:16px;background:${BRAND_BG};border:1px solid ${BRAND_BORDER};border-radius:12px;text-align:center;">
      ${linkBox.label ? `<p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND_FAINT};">${escapeHtml(linkBox.label)}</p>` : ''}
      <p style="margin:0;font-size:14px;word-break:break-all;"><a href="${escapeHtml(linkBox.url)}" style="color:${BRAND_MUTED};text-decoration:none;">${escapeHtml(linkBox.url)}</a></p>
    </div>`
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
 * @param {{label?:string,url:string}} [params.linkBox] — Optional visible plain-link fallback
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
  linkBox = null,
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
<body style="margin:0;padding:0;background:${BRAND_BG};">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(safePreview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:32px;background:${BRAND_CARD};color:${BRAND_TEXT};border-radius:24px;border:1px solid ${BRAND_BORDER};">
          <div style="text-align:center;margin-bottom:24px;">
            <img src="${appUrl.replace(/\/$/, '')}/brand/snaprooms-mark-email.png" width="26" height="28" alt="" style="display:inline-block;vertical-align:middle;margin-right:8px;border:0;">
            <span style="font-size:20px;font-weight:800;color:${BRAND_TEXT};letter-spacing:-0.5px;vertical-align:middle;">${escapeHtml(strings.brand)}</span><span style="font-size:20px;font-weight:800;color:${BRAND_LIME_DARK};">.</span>
          </div>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;text-align:center;">${escapeHtml(safeHeadline)}</h1>
          ${paragraphsToHtml(safeBody)}
          ${ctaToHtml(cta)}
          ${linkBoxToHtml(linkBox)}
          <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid ${BRAND_BORDER};text-align:center;font-size:13px;color:${BRAND_FAINT};">
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
