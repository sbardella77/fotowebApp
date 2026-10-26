import { BASE_URL, ORGANIZATION_ID } from './constants'

/**
 * Organization node. @id is stable and locale-invariant: it is the same
 * legal entity regardless of which locale page references it.
 *
 * legalName and sameAs are deliberately omitted — no registered legal
 * entity name or official social profile URL exists anywhere in this
 * codebase, and fabricating either would be a false claim in structured
 * data read by search engines and AI crawlers.
 */
export function getOrganizationNode() {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: 'SnapRooms',
    url: BASE_URL,
    logo: `${BASE_URL}/icon-512.png`,
    description:
      'SnapRooms is a web app for collecting guest photos and videos from weddings, parties and corporate events in one shared gallery. Guests upload by link or QR code, with no app and no signup.',
  }
}
