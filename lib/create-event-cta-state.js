/**
 * Pure resolver for the public "Create event" CTA href.
 *
 * Authenticated owners are sent directly to the dashboard with a flag that
 * auto-opens the create-event modal. Anonymous visitors keep the public
 * homepage flow.
 */
export function resolveCreateEventCtaState({ authenticated }) {
  if (authenticated) {
    return { href: '/dashboard?createEvent=1' }
  }
  return { href: '/' }
}
