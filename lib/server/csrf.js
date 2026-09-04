import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

function getCsrfSecret() {
  const secret = process.env.CSRF_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CSRF_SECRET is required in production')
  }
  // eslint-disable-next-line no-console
  console.warn('[security] CSRF_SECRET not set; using development fallback. Set CSRF_SECRET for production.')
  return 'snaprooms-dev-csrf-secret-replace-in-production'
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodePayload(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function secureCompare(a, b) {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// Converts a Vercel-supplied hostname (documented as a bare host, no
// protocol — but never assumed here) into a normalized origin string.
// Trusts only the exact value the platform injected; performs no
// suffix/substring/wildcard matching against "vercel.app" or any other host.
function vercelHostToOrigin(hostLike) {
  if (typeof hostLike !== 'string') return null
  const trimmed = hostLike.trim().replace(/\/$/, '')
  if (!trimmed) return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return `${url.protocol}//${url.host}`
    } catch {
      return null
    }
  }
  return `https://${trimmed}`
}

export function getAllowedOrigins() {
  const origins = new Set()
  const envOrigins = process.env.ALLOWED_ORIGINS
  if (envOrigins) {
    envOrigins
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean)
      .forEach((o) => origins.add(o))
  }
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) origins.add(appUrl.replace(/\/$/, ''))
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL.replace(/\/$/, '')}`)
  // Preview only: trust this deployment's own Vercel-generated stable branch
  // alias (VERCEL_BRANCH_URL), so every branch Preview works without
  // manually maintaining a per-branch ALLOWED_ORIGINS entry. Never applied
  // outside VERCEL_ENV === 'preview' — Production and Development origin
  // trust are completely unaffected by this variable.
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_BRANCH_URL) {
    const branchOrigin = vercelHostToOrigin(process.env.VERCEL_BRANCH_URL)
    if (branchOrigin) origins.add(branchOrigin)
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:3000')
  }
  return Array.from(origins).filter(Boolean)
}

function normalizeOrigin(origin) {
  try {
    const url = new URL(origin)
    return `${url.protocol}//${url.host}`.toLowerCase()
  } catch {
    return null
  }
}

export function isAllowedOrigin(origin) {
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  return getAllowedOrigins().some((allowed) => allowed.toLowerCase() === normalized)
}

export function verifySameOriginRequest(request) {
  const origin = request.headers.get('origin') || request.headers.get('referer')
  if (!origin) {
    return {
      allowed: false,
      code: 'origin_missing',
      message: 'Security check failed. Please refresh the page and try again.',
    }
  }
  if (!isAllowedOrigin(origin)) {
    return {
      allowed: false,
      code: 'origin_not_allowed',
      message: 'Request origin is not allowed.',
    }
  }
  return { allowed: true, origin }
}

export function createCsrfToken(ownerEmail) {
  const payload = {
    email: ownerEmail.toLowerCase().trim(),
    nonce: randomBytes(16).toString('base64url'),
    exp: Date.now() + TOKEN_TTL_MS,
  }
  const encoded = encodePayload(payload)
  const signature = createHmac('sha256', getCsrfSecret()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyCsrfToken(token, ownerEmail) {
  if (!token || !ownerEmail) return false
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return false
  try {
    const expectedSignature = createHmac('sha256', getCsrfSecret()).update(encoded).digest('base64url')
    if (!secureCompare(signature, expectedSignature)) return false
    const payload = decodePayload(encoded)
    if (Number(payload.exp) <= Date.now()) return false
    if (payload.email.toLowerCase().trim() !== ownerEmail.toLowerCase().trim()) return false
    return true
  } catch {
    return false
  }
}

export function getCsrfTokenFromRequest(request) {
  return request.headers.get('x-csrf-token') || request.headers.get('x-xsrf-token') || ''
}

export function requireCsrfProtection(request, ownerEmail) {
  try {
    const originCheck = verifySameOriginRequest(request)
    if (!originCheck.allowed) {
      return {
        success: false,
        status: 403,
        code: originCheck.code,
        message: originCheck.message,
      }
    }

    const token = getCsrfTokenFromRequest(request)
    if (!token) {
      return {
        success: false,
        status: 403,
        code: 'csrf_missing',
        message: 'Security check failed. Please refresh the page and try again.',
      }
    }

    if (!verifyCsrfToken(token, ownerEmail)) {
      return {
        success: false,
        status: 403,
        code: 'csrf_invalid',
        message: 'Security check failed. Please refresh the page and try again.',
      }
    }

    return { success: true }
  } catch (error) {
    console.error('[csrf] Protection check failed:', error.message)
    return {
      success: false,
      status: 503,
      code: 'csrf_misconfigured',
      message: 'Security verification is temporarily unavailable. Please try again later.',
    }
  }
}
