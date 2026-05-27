# Effective Event Access State

> Single source of truth for interpreting an event's premium capabilities in SnapRooms.

## Why this model exists

Before this model, premium logic was scattered across the codebase:
- `billingTier` checked inline in components
- `ownerPlan` compared manually in 10+ files
- `originalDownloadUnlocked` evaluated differently in UI and API
- Watermark, gallery ZIP, private delivery, and upgrade CTAs each re-implemented the same boolean rules

`resolveEffectiveEventAccessState()` centralises all of this into one isomorphic (client + server) pure function. Every feature decision — badge, CTA, download, watermark, upload limit, private delivery — must derive from this state object.

## Source of truth

```
lib/event-access.js              → pure resolver (isomorphic)
lib/server/event-access.js       → Prisma-aware wrapper
lib/server/entitlements.js       → count-based limits (kept for current/max/upgradePath)
```

**Rule:** No new premium feature should read `billingTier`, `ownerPlan`, or `originalDownloadUnlocked` directly if it can consume `resolveEffectiveEventAccessState()` instead.

## Input dimensions

| Input | Source | Values |
|-------|--------|--------|
| `billingTier` | Event-level purchase | `null`, `'pro_event'`, `'wedding_pro'` |
| `ownerPlan` | Account-level subscription | `null`, `'free'`, `'professional'`, `'business'`, `'pro'` |
| `originalDownloadUnlocked` | One-time payment per event | `boolean` |

## Output state

| Field | Meaning |
|-------|---------|
| `effectivePlan` | Canonical plan string: `ownerPlan` → `billingTier` → `'unlocked'` → `'free'` |
| `accountPremium` | Owner has a paid subscription (`professional`/`business`/`pro`) |
| `eventUpgraded` | Event has `billingTier` (`pro_event` or `wedding_pro`) |
| `originalUnlocked` | `originalDownloadUnlocked === true` |
| `isPremium` | Any premium state is active (`accountPremium \|\| eventUpgraded \|\| originalUnlocked`) |
| `isFree` | Opposite of `isPremium` |
| `canDownloadOriginal` | Single-photo download is unbranded and original-quality is available |
| `canDownloadGallery` | Full-gallery ZIP download is permitted |
| `hasUnbrandedDownloads` | Downloads do not receive a SnapRooms watermark |
| `hasPrivateDelivery` | Professional file delivery and photographer upload link are available |
| `canUploadUnlimited` | Room accepts unlimited photo uploads |
| `canCreateUnlimitedRooms` | Owner can create unlimited rooms |

## Critical edge case: `originalDownloadUnlocked = true`

This is the most frequently misunderstood state. It unlocks **only** single-photo original-quality download for guests.

| Feature | Enabled? | Why |
|---------|----------|-----|
| Single-photo download (no watermark) | ✅ Yes | `hasUnbrandedDownloads = true` |
| Gallery ZIP download | ❌ No | `canDownloadGallery` requires `accountPremium \|\| eventUpgraded` |
| Premium badge | ❌ No | Badge logic uses `accountPremium \|\| eventUpgraded` (excludes `originalUnlocked`) |
| Private delivery | ❌ No | Requires `wedding_pro` or `accountPremium` |
| Photographer link | ❌ No | Requires `hasPrivateDelivery` |
| Unlimited uploads | ❌ No | Requires `eventUpgraded \|\| accountPremium` |

**UI implication:** The room page must check `canDownloadGallery` and `hasUnbrandedDownloads` independently. Using `isFree` alone would incorrectly show "gallery download available" when only `originalDownloadUnlocked` is true.

## Scenario reference

### 1. Free account + Free event
```js
resolveEffectiveEventAccessState({
  billingTier: null,
  originalDownloadUnlocked: false,
  ownerPlan: 'free',
})
// → isFree: true, canDownloadGallery: false, hasUnbrandedDownloads: false,
//   hasPrivateDelivery: false, canUploadUnlimited: false
```
- Badge: none / "Free"
- Watermark: yes
- Gallery ZIP: blocked (403)
- Upgrade CTAs: visible
- Private delivery: hidden

### 2. Free account + Pro Event
```js
resolveEffectiveEventAccessState({
  billingTier: 'pro_event',
  originalDownloadUnlocked: false,
  ownerPlan: 'free',
})
// → eventUpgraded: true, isFree: false, canDownloadGallery: true,
//   hasUnbrandedDownloads: true, hasPrivateDelivery: false
```
- Badge: "Pro Event"
- Watermark: no
- Gallery ZIP: allowed
- Private delivery: blocked (403)
- Upgrade CTAs: hidden

### 3. Free account + Wedding Pro
```js
resolveEffectiveEventAccessState({
  billingTier: 'wedding_pro',
  originalDownloadUnlocked: false,
  ownerPlan: 'free',
})
// → eventUpgraded: true, isFree: false, canDownloadGallery: true,
//   hasUnbrandedDownloads: true, hasPrivateDelivery: true
```
- Badge: "Wedding Pro"
- Watermark: no
- Gallery ZIP: allowed
- Private delivery: allowed
- Photographer link: allowed

### 4. Professional / Business account + Free event
```js
resolveEffectiveEventAccessState({
  billingTier: null,
  originalDownloadUnlocked: false,
  ownerPlan: 'professional',
})
// → accountPremium: true, isFree: false, canDownloadGallery: true,
//   hasUnbrandedDownloads: true, hasPrivateDelivery: true
```
- Badge: "Premium active" (account prevails)
- Watermark: no
- Gallery ZIP: allowed
- Private delivery: allowed
- Event-level upgrade CTAs: hidden

### 5. Professional / Business + Pro Event / Wedding Pro
```js
resolveEffectiveEventAccessState({
  billingTier: 'pro_event',
  originalDownloadUnlocked: false,
  ownerPlan: 'professional',
})
// → accountPremium: true (prevails over billingTier)
```
- Badge: "Premium active"
- All premium features enabled
- No redundant upgrade CTAs

### 6. originalDownloadUnlocked only
```js
resolveEffectiveEventAccessState({
  billingTier: null,
  originalDownloadUnlocked: true,
  ownerPlan: 'free',
})
// → originalUnlocked: true, isPremium: true, isFree: false,
//   canDownloadOriginal: true, canDownloadGallery: false,
//   hasUnbrandedDownloads: true, hasPrivateDelivery: false
```
- Badge: **none** (badge logic excludes `originalUnlocked`)
- Single photo: unbranded, original quality available
- Gallery ZIP: blocked
- Private delivery: blocked
- Upgrade CTAs: still visible (owner can buy Pro Event / Wedding Pro)

## What stays in `entitlements.js`

Two functions remain because they return **quantitative** data for error messages:

- `checkRoomUploadEntitlement(prisma, event)` → `{ allowed, current, max, upgradePath }`
- `checkOwnerRoomCreationEntitlement(prisma, owner)` → `{ allowed, current, max, upgradePath }`

Both now use `resolveEffectiveEventAccessState` internally for the boolean decision, but still perform DB counts when the limit actually applies.

## Migration checklist for new features

When adding a new premium-gated feature:

1. Ask: "Should this be part of `resolveEffectiveEventAccessState`?"
2. If yes, add the flag to `lib/event-access.js`.
3. Consume the flag in UI and API — never read `billingTier` / `ownerPlan` / `originalDownloadUnlocked` directly.
4. Update this document with the new scenario behaviour.
