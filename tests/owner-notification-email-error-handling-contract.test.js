import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const source = readFileSync(resolve(ROOT, 'app/api/[[...path]]/route.js'), 'utf8')

// Discovered during live-Preview QA: sendOwnerNotificationEmail discarded the
// Resend SDK's own { data, error } result entirely, so an API-level send
// rejection (e.g. the onboarding@resend.dev sandbox sender rejecting a
// non-account recipient) never reached even the function's own catch block —
// resend.emails.send() resolves normally with `error` populated, it does not
// throw. The sibling saveEventByEmail route already gets this right; this
// brings sendOwnerNotificationEmail in line with it.
describe('sendOwnerNotificationEmail — surfaces Resend API-level send errors', () => {
  it('captures the error field from both resend.emails.send() calls', () => {
    expect(source).toMatch(/const \{ error: setupSendError \} = await resend\.emails\.send\(/)
    expect(source).toMatch(/const \{ error: addedSendError \} = await resend\.emails\.send\(/)
  })

  it('logs a send-level error for both the setup_password and room_added paths', () => {
    expect(source).toContain('[sendOwnerNotificationEmail] Resend error (setup_password):')
    expect(source).toContain('[sendOwnerNotificationEmail] Resend error (room_added):')
  })

  it('does not throw on a send-level error — event creation stays best-effort, non-blocking', () => {
    const fnStart = source.indexOf('const sendOwnerNotificationEmail = async')
    const fnBody = source.slice(fnStart, fnStart + 3500)
    expect(fnBody).not.toMatch(/if \(setupSendError\)[^}]*throw/)
    expect(fnBody).not.toMatch(/if \(addedSendError\)[^}]*throw/)
  })
})

// Same class of bug, found in a third location while using this route to
// retest email delivery: forgotOwnerPassword also discarded the Resend
// { error } result. Its response is intentionally the same generic
// anti-enumeration message regardless of outcome, so — unlike a client-
// facing contract — only the server-side logging needed fixing here.
describe('forgotOwnerPassword — surfaces Resend API-level send errors', () => {
  it('captures the error field from its resend.emails.send() call', () => {
    expect(source).toMatch(/const \{ error: forgotSendError \} = await resend\.emails\.send\(/)
  })

  it('logs a send-level error without changing the anti-enumeration response', () => {
    expect(source).toContain('[forgotOwnerPassword] Resend error:')
    expect(source).toContain("message: 'If an account with this email exists, a password reset link has been sent.'")
  })
})

// Fourth instance of the same bug, found via a full-codebase sweep after
// fixing forgotOwnerPassword: resendOwnerAccess (a distinct "resend my
// access link" route) also discarded the Resend { error } result.
describe('resendOwnerAccess — surfaces Resend API-level send errors', () => {
  it('captures the error field from its resend.emails.send() call', () => {
    expect(source).toMatch(/const \{ error: resendAccessSendError \} = await resend\.emails\.send\(/)
  })

  it('logs a send-level error without changing the anti-enumeration response', () => {
    expect(source).toContain('[resendOwnerAccess] Resend error:')
    const fnStart = source.indexOf('const resendOwnerAccess = async')
    const nextFnStart = source.indexOf('const recoverOwnerAccess = async')
    const fnBody = source.slice(fnStart, nextFnStart)
    expect(fnBody).toContain("message: 'If an account with this email exists, a password reset link has been sent.'")
  })

  it('never logs the raw token, only the structured Resend error object', () => {
    const fnStart = source.indexOf('const resendOwnerAccess = async')
    const nextFnStart = source.indexOf('const recoverOwnerAccess = async')
    const fnBody = source.slice(fnStart, nextFnStart)
    const errorLogLine = fnBody.split('\n').find((l) => l.includes('[resendOwnerAccess] Resend error:'))
    expect(errorLogLine).not.toMatch(/rawToken/)
  })
})
