# SnapRooms Cookie Policy

> **Status:** Technical cookies only — no consent banner required today.  
> **Last reviewed:** 2026-06-01

---

## 1. Inventory

| Cookie | Purpose | Essential | HttpOnly | Secure | SameSite | Path | Max-Age | Set by |
|--------|---------|-----------|----------|--------|----------|------|---------|--------|
| `NEXT_LOCALE` | Language preference | ✅ Yes | No | HTTPS only | `Lax` | `/` | 1 year | Middleware + Client JS |
| `snaprooms_owner_session` | Owner dashboard session | ✅ Yes | Yes | Production | `Lax` | `/` | 7 days | Server (login) |
| `event_gallery_admin_session` | Admin session | ✅ Yes | Yes | Production | `Lax` | `/` | 7 days | Server (login) |
| `sidebar_state` | Dashboard sidebar UI state | ✅ Yes | No | HTTPS only | `Lax` | `/` | 7 days | Client JS |

**Cookies NOT present:**
- `snaprooms_csrf` — not implemented (SameSite=Lax on session cookie provides baseline protection)
- `snaprooms_cookie_consent` — not required today (no non-essential cookies)
- `__vercel_toolbar` — Vercel tooling cookie; not set by application code

---

## 2. Why No Banner Is Needed Today

Under EU **ePrivacy Directive** and **GDPR**, a cookie consent banner is required only when setting **non-essential** cookies (profiling, marketing, analytics that identify individuals across sites, etc.).

SnapRooms currently sets **only technical/necessary cookies**:

- **Authentication** — required to keep users logged in (`snaprooms_owner_session`, `event_gallery_admin_session`)
- **Preferences** — required to remember language and UI state (`NEXT_LOCALE`, `sidebar_state`)

**Third-party tracking:**
- PostHog is loaded client-side via `posthog-js` with `respect_dnt: true` (respects Do-Not-Track browser settings)
- No Google Analytics, Meta Pixel, TikTok Pixel, Hotjar, or advertising cookies are loaded

> **Conclusion:** A cookie banner is **not required today** because all cookies are strictly necessary for the functioning of the service.

---

## 3. When a Banner Will Be Required

A cookie consent mechanism **must** be introduced before adding any of the following:

- Google Analytics 4 (or any analytics that tracks users across sessions/pages with identifiable data)
- Meta Pixel / TikTok Pixel / LinkedIn Insight Tag (advertising/retargeting)
- Hotjar / FullStory / LogRocket (behavioral recording)
- Any cookie used for profiling, remarketing, or cross-site tracking

**Implementation requirements for future banner:**
- Pre-select only **"Necessary"** category
- **Do not pre-select** Marketing, Analytics, or Functional categories
- Provide **"Accept All"**, **"Reject Non-Essential"**, and **"Manage Preferences"** options
- Store consent preference in `snaprooms_cookie_consent` (or equivalent)
- Block non-essential scripts until consent is obtained
- Allow users to revoke/change consent at any time (e.g. via footer link)
- Log consent timestamp and choice for legal records

---

## 4. Production Checklist — `OWNER_SESSION_SECRET`

The owner session token is signed with `OWNER_SESSION_SECRET`. In **production**, the app **will throw** if this variable is missing (no silent fallback).

### Generate
```bash
openssl rand -hex 32
```

### Configure in Vercel
1. Go to **Vercel Dashboard** → Project → **Settings** → **Environment Variables**
2. Add to **Production** environment:
   - `OWNER_SESSION_SECRET` = `<64-char hex from openssl>`
3. (Optional) Add `ADMIN_SESSION_SECRET` as fallback/alias
4. **Redeploy** after setting the variable

### Verify
- Login to dashboard should work normally
- Missing secret in production logs: `OWNER_SESSION_SECRET missing in production`

---

## 5. Client-Side Storage Audit

No `localStorage` or `sessionStorage` is used for tracking. The only client-side persistence is via cookies listed above.

---

*This policy should be reviewed by legal counsel before commercial launch in the EU.*
