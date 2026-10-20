import { describe, it, expect } from 'vitest'
import { safeJsonLdStringify } from '@/lib/structured-data/serialize'

describe('safeJsonLdStringify prevents <script> breakout from translator-editable content', () => {
  it('escapes a literal </script> so it can never terminate the surrounding script tag', () => {
    const malicious = {
      a: 'Learn more at our blog</script><script>alert(1)</script>',
    }
    const output = safeJsonLdStringify(malicious)
    expect(output).not.toContain('</script')
    expect(output).not.toContain('<script')
  })

  it('still round-trips to the original, unescaped string via JSON.parse', () => {
    const malicious = {
      a: 'Learn more at our blog</script><script>alert(1)</script>',
    }
    const output = safeJsonLdStringify(malicious)
    const parsed = JSON.parse(output)
    expect(parsed.a).toBe(malicious.a)
  })

  it('escapes bare <, >, and & anywhere in a string value', () => {
    const input = { a: 'A & B <tag> more & <b>bold</b>' }
    const output = safeJsonLdStringify(input)
    expect(output).not.toMatch(/[<>&]/)
    expect(JSON.parse(output)).toEqual(input)
  })

  it('does not alter non-string JSON structure (numbers, booleans, nested objects/arrays)', () => {
    const input = { n: 42, b: true, nested: { arr: [1, 2, { x: 'a<b' }] } }
    const output = safeJsonLdStringify(input)
    expect(JSON.parse(output)).toEqual(input)
  })
})
