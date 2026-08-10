import { describe, it, expect } from 'vitest'
import { hashPassword, createPasswordHash, verifyPassword } from '@/lib/server/owner-password'

// Fixture generated once, offline, with the OLD synchronous implementation
// (`scryptSync(password, salt, 64).toString('hex')`), then hardcoded here.
// This is intentional: the test must prove compatibility with a legacy
// artifact, not compare two runtime implementations of the same algorithm.
const LEGACY_FIXTURE = {
  password: 'LegacyPassw0rd!',
  salt: 'f4a747553d86066325f7ebb59c70d610',
  hash: 'e02c7ea16eec6174813b5435d36da172eed6e55f66822b997cca90bafb034b5b8186c15efae8a1751d7ee4e2820a6a674dfa874fac72c6d0ee79a8d949e4cf45',
}

describe('owner-password async scrypt migration', () => {
  it('A. verifies a legacy scryptSync-produced hash via the new async verifyPassword', async () => {
    const result = await verifyPassword(LEGACY_FIXTURE.password, LEGACY_FIXTURE.salt, LEGACY_FIXTURE.hash)
    expect(result).toBe(true)
  })

  it('B. a hash produced by the new async createPasswordHash verifies correctly', async () => {
    const { salt, hash } = await createPasswordHash('BrandNewPassw0rd!')
    const result = await verifyPassword('BrandNewPassw0rd!', salt, hash)
    expect(result).toBe(true)
  })

  it('C. rejects a wrong password', async () => {
    const { salt, hash } = await createPasswordHash('CorrectPassw0rd!')
    const result = await verifyPassword('WrongPassw0rd!', salt, hash)
    expect(result).toBe(false)
  })

  it('D. missing salt or hash is rejected without throwing (unchanged prior behavior)', async () => {
    await expect(verifyPassword('anything', '', 'somehash')).resolves.toBe(false)
    await expect(verifyPassword('anything', 'somesalt', '')).resolves.toBe(false)
    await expect(verifyPassword('anything', null, null)).resolves.toBe(false)
  })

  it('E. same password with different salts produces different hashes', async () => {
    const first = await createPasswordHash('SamePassword123!')
    const second = await createPasswordHash('SamePassword123!')
    expect(first.salt).not.toBe(second.salt)
    expect(first.hash).not.toBe(second.hash)
  })

  it('F. hashPassword with a deterministic salt matches the legacy fixture exactly', async () => {
    const hash = await hashPassword(LEGACY_FIXTURE.password, LEGACY_FIXTURE.salt)
    expect(hash).toBe(LEGACY_FIXTURE.hash)
  })

  it('production module no longer imports/calls scryptSync', async () => {
    const fs = await import('node:fs/promises')
    const source = await fs.readFile(new URL('../lib/server/owner-password.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/scryptSync/)
  })
})
