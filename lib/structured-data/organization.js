import { BASE_URL, ORGANIZATION_ID } from './constants'

/**
 * Organization node. @id is stable and locale-invariant: it is the same
 * legal entity regardless of which locale page references it.
 *
 * sameAs lists only the official profiles confirmed by the owner
 * (2026-10-26). legalName stays omitted — no registered legal entity name
 * exists in this codebase, and fabricating one would be a false claim in
 * structured data read by search engines and AI crawlers.
 */
export const OFFICIAL_PROFILES = [
  'https://www.linkedin.com/company/146159907',
  'https://www.instagram.com/snaprooms.app/',
]

export function getOrganizationNode() {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: 'SnapRooms',
    url: BASE_URL,
    logo: `${BASE_URL}/icon-512.png`,
    description:
      'SnapRooms is a web app for collecting guest photos and videos from weddings, parties and corporate events in one shared gallery. Guests upload by link or QR code, with no app and no signup.',
    sameAs: OFFICIAL_PROFILES,
  }
}
