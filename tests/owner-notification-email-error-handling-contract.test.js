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
