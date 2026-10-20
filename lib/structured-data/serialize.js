/**
 * Serialize a JSON-LD payload for safe inline embedding in a <script> tag.
 *
 * JSON.stringify alone does not protect against script-tag breakout: a
 * translator-edited string containing the literal substring "</script>"
 * would terminate the tag early and let subsequent characters be parsed as
 * HTML. Escaping "<", ">" and "&" to their unicode equivalents prevents
 * this while remaining valid, parseable JSON once the browser's HTML
 * parser hands the text back to JSON.parse.
 */
export function safeJsonLdStringify(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}
