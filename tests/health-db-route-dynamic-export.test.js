import { describe, it, expect } from 'vitest'

// STEP 5.13: app/api/health/db/route.js must opt out of Next.js static
// route optimization, otherwise `next build` can materialize/execute the
// handler at build time (proven empirically in STEP 5.11b). This asserts
// the real route module's exported segment config, not a source grep.

describe('app/api/health/db/route.js — build-safety segment config (STEP 5.13 regression guard)', () => {
  it('exports dynamic = "force-dynamic"', async () => {
    const route = await import('@/app/api/health/db/route')

    expect(route.dynamic).toBe('force-dynamic')
  })
})
