import { localizedPath } from '@/lib/i18n/config'
import { BASE_URL } from './constants'

/**
 * Pull `count` sequentially-numbered {prefix}NQuestion/{prefix}NAnswer pairs
 * out of a dictionary namespace object (e.g. getDictionary(locale).birthday)
 * — the exact same object each page's visible FAQ accordion already reads
 * from, so the structured data can never drift from what guests actually
 * see rendered on the page.
 *
 * A pair missing either its question or its answer string is skipped
 * rather than emitted as `undefined` — this can happen if a locale's
 * dictionary is incomplete for a given slot (a pre-existing translation
 * gap, not something this generator should paper over by inventing copy).
 * Skipping keeps the resulting FAQPage schema valid JSON-LD even when the
 * underlying content itself is incomplete.
 */
export function collectFaqPairs(namespace, prefix, count) {
  const pairs = []
  for (let i = 1; i <= count; i += 1) {
    const q = namespace[`${prefix}${i}Question`]
    const a = namespace[`${prefix}${i}Answer`]
    if (q && a) {
      pairs.push({ q, a })
    }
  }
  return pairs
}

/**
 * FAQPage node for one localized marketing page. Only call this for pages
 * that actually render visible FAQ content — adding FAQPage schema to a
 * page without matching visible Q&A text is treated as spam by search
 * engines regardless of accuracy.
 */
export function getFaqPageNode({ locale, path, questions }) {
  const url = `${BASE_URL}${localizedPath(locale, path)}`
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: questions.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: a,
      },
    })),
  }
}
