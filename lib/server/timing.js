/**
 * Minimal production-safe timing wrapper for API routes.
 * Logs duration and flags slow requests via console thresholds.
 */

const THRESHOLDS = {
  warn: 2000,
  error: 5000,
  critical: 10000,
}

export function withTiming(routeName, handler, extra = {}) {
  return async (...args) => {
    const start = Date.now()
    try {
      const result = await handler(...args)
      const duration = Date.now() - start
      const level = duration >= THRESHOLDS.critical
        ? 'error'
        : duration >= THRESHOLDS.error
          ? 'warn'
          : 'log'
      const meta = typeof extra.getMeta === 'function' ? extra.getMeta(result, ...args) : ''
      if (level === 'warn') {
        console.warn(`[timing-slow] route=${routeName} durationMs=${duration}${meta ? ' ' + meta : ''}`)
      } else if (level === 'error') {
        console.error(`[timing-critical] route=${routeName} durationMs=${duration}${meta ? ' ' + meta : ''}`)
      } else {
        console.log(`[timing] route=${routeName} durationMs=${duration}${meta ? ' ' + meta : ''}`)
      }
      return result
    } catch (err) {
      const duration = Date.now() - start
      console.error(`[timing-error] route=${routeName} durationMs=${duration} error=${err?.message || err}`)
      throw err
    }
  }
}
