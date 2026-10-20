# SnapRooms Cookie Policy

> **Status:** Consent-gated analytics cookies are implemented (PRIVACY-CONSENT-001). Strictly necessary cookies continue to require no consent.
> **Last reviewed:** 2026-10-20
> **DPO/legal sign-off:** NOT YET OBTAINED — see §6. Treat every figure in this document marked "pending DPO verification" as provisional until confirmed by a qualified Data Protection Officer or counsel.

---

## 1. Inventory

| Cookie | Purpose | Essential | HttpOnly | Secure | SameSite | Path | Max-Age | Set by |
|--------|---------|-----------|----------|--------|----------|------|---------|--------|
| `NEXT_LOCALE` | Language preference | ✅ Yes | No | HTTPS only | `Lax` | `/` | 1 year | Middleware + Client JS |
| `snaprooms_owner_session` | Owner dashboard session | ✅ Yes | Yes | Production | `Lax` | `/` | 7 days | Server (login) |
| `event_gallery_admin_session` | Admin session | ✅ Yes | Yes | Production | `Lax` | `/` | 7 days | Server (login) |
| `sidebar_state` | Dashboard sidebar UI state | ✅ Yes | No | HTTPS only | `Lax` | `/` | 7 days | Client JS |
| `snaprooms_cookie_consent` | Stores the visitor's analytics consent decision (`unknown`/`accepted`/`rejected`/`withdrawn`) | ✅ Yes (it is the consent record itself, not a tracking cookie) | No | HTTPS only | `Lax` | `/` | 395 days (pending DPO verification — see §2) | Client JS (`lib/consent/cookie.js`) |
| PostHog persistence (`ph_<project-key>_posthog`) | PostHog's own analytics identifier/state, stored via `localStorage` and, per the installed SDK's default persistence mode, potentially also a cookie of the same name | ❌ No — only set after consent | No | Governed by the PostHog SDK, not configured by this app | Governed by the PostHog SDK | Governed by the PostHog SDK | Governed by PostHog's own default retention — **pending DPO verification, see §2** | PostHog SDK (`posthog-js`), loaded only after consent |

**Cookies NOT present:**
- `snaprooms_csrf` — not implemented (SameSite=Lax on session cookie provides baseline protection)
- `__vercel_toolbar` — Vercel tooling cookie; not set by application code

---

## 2. Consent Mechanism (current)

SnapRooms now sets one **non-essential, consent-gated** analytics integration (PostHog) alongside its pre-existing strictly necessary cookies. A cookie consent banner is shown to every visitor who has not yet made a choice ("Accept all" / "Reject non-essential" / "Manage preferences"), implemented in `components/cookie-consent-banner.jsx` and reopenable at any time via the "Cookie Preferences" link in the footer.

**Three separate lifetimes apply — do not conflate them:**

1. **Consent-preference lifetime** — how long the visitor's accept/reject/withdraw choice itself is remembered, before the banner is shown again. Currently `395 days` (`CONSENT_MAX_AGE_DAYS` in `lib/consent/state.js`), chosen as a commonly-cited EU-guidance upper bound. **Pending DPO verification** for this product's specific jurisdiction(s) — not yet a confirmed legal requirement.
2. **Analytics identifier lifetime** — how long PostHog's own `ph_<project-key>_posthog` identifier persists in the visitor's browser (localStorage, and potentially a same-named cookie depending on the SDK's default persistence mode). This is governed entirely by the `posthog-js` SDK's own defaults, which this application does not override (no `persistence` option is set — confirmed by reading `lib/analytics/posthog-client.js`). **Pending DPO verification** — the exact default lifetime should be confirmed against the installed SDK version rather than assumed.
3. **Analytics event retention** — how long captured event data is retained on PostHog's servers once sent. This is **not configured by this application's code at all** — it is governed solely by PostHog's own project/account settings and any data-processing agreement in place. **Pending DPO verification** — no figure is asserted here because none has been confirmed.

When a visitor rejects or withdraws consent, the client:
- Never loads the PostHog SDK at all (if not yet accepted), or
- Calls `opt_out_capturing()` and removes the `ph_<project-key>_posthog` persistence key (if previously accepted) — see `lib/analytics/posthog-client.js` for the exact mechanism and its documented rationale.
- Never touches `snaprooms_cookie_consent` itself, `NEXT_LOCALE`, or any session cookie.

**What is captured (confirmed from source, `lib/analytics/events.js`):** named product-usage events only (e.g. page views, button clicks), explicitly without PII in event names. Session Replay and autocapture are both explicitly disabled in the SDK configuration (`disable_session_recording: true`, `autocapture: false`) — this is a code-level guarantee independent of the PostHog project dashboard's own toggle state.

**Identifier accuracy note:** this is pseudonymous, not anonymous, for signed-in Owners. `lib/analytics/track-client.js`'s `identifyUser()` is called on the Owner login path (confirmed in `app/dashboard/login/page-client.js`), which links the browser's PostHog events to a stable identifier (`owner:<Owner.id>`, from `lib/analytics/identity.js` — never email, but reversible to the Owner's account by anyone with access to both systems). Guests are not identified this way and remain on PostHog's own auto-generated technical ID.

**What is NOT captured:** automatic screen recordings, automatic click-tracking of every DOM element, or any event not explicitly listed in `lib/analytics/events.js`.

---

## 3. Server-Side Analytics (separate, unaffected by this banner)

SnapRooms also sends server-side analytics events via a separate `posthog-node` integration (`lib/analytics/track-server.js`, `lib/server/posthog-query.js`), used for internal business metrics. **This pipeline is independent of the client-side consent gate described above and is not affected by a visitor's accept/reject/withdraw choice in the browser banner.** Whether and how this separate server-side pipeline itself requires a distinct legal basis or disclosure is tracked as a known open item (see PRIVACY-DPO-003) and is out of scope for this document's cookie inventory, since it does not set any browser cookie.

---

## 4. Known Open Items Requiring DPO/Legal Sign-Off

None of the following are resolved by this document — they are listed here precisely so they are not silently assumed:

- Confirm or adjust the 395-day consent-preference lifetime for SnapRooms' actual jurisdiction(s) of operation.
- Confirm PostHog's current Data Processing Agreement status, applicable international data-transfer safeguards, and subprocessor list for this specific account/project — not inferred from the ingestion region configured in code.
- Confirm the actual analytics-event retention period configured on PostHog's side.
- Confirm whether the separate server-side `posthog-node` pipeline (§3) requires its own consent/disclosure treatment.

---

## 5. Production Checklist — `OWNER_SESSION_SECRET`

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

## 6. Client-Side Storage Audit

`localStorage` is used by the PostHog SDK (only after consent) to persist its own analytics identifier — this is the one documented exception to the prior "no localStorage" state. No other client-side storage beyond the cookies listed in §1 is used for tracking.

---

*This policy should be reviewed by qualified legal counsel / a Data Protection Officer before relying on it as a compliance record — see §4 for the specific items still outstanding.*
