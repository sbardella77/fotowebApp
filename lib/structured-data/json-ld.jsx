import { safeJsonLdStringify } from './serialize'

/**
 * Server-rendered <script type="application/ld+json"> wrapper. Has no
 * client-side behavior, so it must never be imported by a 'use client'
 * component — only by the server-rendered app/[locale] page.js files.
 */
export function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(data) }}
    />
  )
}
