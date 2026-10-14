import { Resend } from 'resend'

// Single shared Resend client, used by every server-side email sender
// (guest-facing event routes, owner auth flows, etc). Extracted out of the
// legacy app/api/[[...path]]/route.js catch-all so it has exactly one
// instance regardless of which module sends an email.
export const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
