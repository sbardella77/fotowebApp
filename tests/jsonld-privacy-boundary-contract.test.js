import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const PRIVATE_DIRS = ['app/api', 'app/dashboard', 'app/admin', 'app/event', 'app/photographer-upload']

function listFilesRecursively(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      found.push(...listFilesRecursively(full))
    } else {
      found.push(full)
    }
  }
  return found
}

describe('JSON-LD / structured-data code never reaches private routes (SEO/privacy P0)', () => {
  it.each(PRIVATE_DIRS)('no file under %s imports from lib/structured-data', (relDir) => {
    const dir = resolve(ROOT, relDir)
    let stat
    try {
      stat = statSync(dir)
    } catch {
      return // directory doesn't exist in this checkout; nothing to check
    }
    if (!stat.isDirectory()) return

    const files = listFilesRecursively(dir)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} must not import lib/structured-data`).not.toMatch(
        /from ['"]@\/lib\/structured-data|require\(['"].*structured-data/
      )
    }
  })

  it('lib/structured-data itself never imports anything from the private route directories', () => {
    const dir = resolve(ROOT, 'lib/structured-data')
    const files = listFilesRecursively(dir)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const privateDir of PRIVATE_DIRS) {
        expect(source).not.toContain(`@/${privateDir}`)
      }
    }
  })
})
