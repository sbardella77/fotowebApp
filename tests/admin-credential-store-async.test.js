import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression coverage for the scryptSync → promisify(scrypt) migration inside
// admin-credential-store.js. All three drivers are exercised with the real
// async hashPassword/scryptAsync path (no verify()/setup() internals are
// mocked out) so the tests prove the actual runtime behavior, not a stub.

let localFileState = null

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(async () => {
    if (!localFileState) {
      const err = new Error('ENOENT')
      err.code = 'ENOENT'
      throw err
    }
    return JSON.stringify(localFileState)
  }),
  writeFile: vi.fn(async (_path, content) => {
    localFileState = JSON.parse(content)
  }),
}))

let prismaAdminCredential = null

const prismaMock = {
  adminCredential: {
    findUnique: vi.fn(async ({ where }) => {
      if (prismaAdminCredential && where?.key === prismaAdminCredential.key) {
        return prismaAdminCredential
      }
      return null
    }),
    create: vi.fn(async ({ data }) => {
      prismaAdminCredential = { ...data }
      return prismaAdminCredential
    }),
  },
}

const getAdminAuthDriverMock = vi.fn()

vi.mock('@/lib/server/prisma-client', () => ({
  getAdminAuthDriver: (...args) => getAdminAuthDriverMock(...args),
  getPrismaClient: vi.fn().mockResolvedValue(prismaMock),
}))

const ORIGINAL_ENV = { ...process.env }

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  localFileState = null
  prismaAdminCredential = null
  delete process.env.ADMIN_PASSWORD
  delete process.env.VERCEL
})

afterEach(() => {
  restoreEnv()
})

describe('admin-credential-store — ENV driver (no scrypt path)', () => {
  it('verify() reflects ADMIN_PASSWORD via plaintext comparison, unaffected by the scrypt migration', async () => {
    getAdminAuthDriverMock.mockReturnValue('env')
    process.env.ADMIN_PASSWORD = 'EnvDriverPassw0rd!'
    const { getAdminCredentialStore } = await import('@/lib/server/admin-credential-store')
    const store = await getAdminCredentialStore()

    expect(await store.verify('EnvDriverPassw0rd!')).toBe(true)
    expect(await store.verify('wrong')).toBe(false)
  })

  it('setup() always throws for the env driver', async () => {
    getAdminAuthDriverMock.mockReturnValue('env')
    const { getAdminCredentialStore } = await import('@/lib/server/admin-credential-store')
    const store = await getAdminCredentialStore()

    await expect(store.setup('whatever')).rejects.toThrow()
  })
})

describe('admin-credential-store — LOCAL driver (real async scrypt)', () => {
  it('setup() generates a hash and verify() accepts the correct password', async () => {
    getAdminAuthDriverMock.mockReturnValue('local')
    const { getAdminCredentialStore } = await import('@/lib/server/admin-credential-store')
    const store = await getAdminCredentialStore()

    const status = await store.setup('LocalDriverPassw0rd!')
    expect(status.configured).toBe(true)
    expect(localFileState.hash).toMatch(/^[a-f0-9]{128}$/)
    expect(localFileState.salt).toMatch(/^[a-f0-9]{32}$/)

    expect(await store.verify('LocalDriverPassw0rd!')).toBe(true)
  })

  it('verify() rejects the wrong password', async () => {
    getAdminAuthDriverMock.mockReturnValue('local')
    const { getAdminCredentialStore } = await import('@/lib/server/admin-credential-store')
    const store = await getAdminCredentialStore()

    await store.setup('LocalDriverPassw0rd!')
    expect(await store.verify('NotThePassword!')).toBe(false)
  })
})

describe('admin-credential-store — PRISMA driver (real async scrypt)', () => {
  it('setup() generates a hash and verify() accepts the correct password', async () => {
    getAdminAuthDriverMock.mockReturnValue('prisma')
    const { getAdminCredentialStore } = await import('@/lib/server/admin-credential-store')
    const store = await getAdminCredentialStore()

    const status = await store.setup('PrismaDriverPassw0rd!')
    expect(status.configured).toBe(true)
    expect(prismaAdminCredential.passwordHash).toMatch(/^[a-f0-9]{128}$/)
    expect(prismaAdminCredential.passwordSalt).toMatch(/^[a-f0-9]{32}$/)

    expect(await store.verify('PrismaDriverPassw0rd!')).toBe(true)
  })

  it('verify() rejects the wrong password', async () => {
    getAdminAuthDriverMock.mockReturnValue('prisma')
    const { getAdminCredentialStore } = await import('@/lib/server/admin-credential-store')
    const store = await getAdminCredentialStore()

    await store.setup('PrismaDriverPassw0rd!')
    expect(await store.verify('NotThePassword!')).toBe(false)
  })

  it('accepts a legacy hash/salt pair produced by the old scryptSync implementation', async () => {
    getAdminAuthDriverMock.mockReturnValue('prisma')
    // Same fixture used in owner-password-async.test.js: generated offline
    // with scryptSync(password, salt, 64).toString('hex').
    prismaAdminCredential = {
      key: 'primary',
      passwordSalt: 'f4a747553d86066325f7ebb59c70d610',
      passwordHash:
        'e02c7ea16eec6174813b5435d36da172eed6e55f66822b997cca90bafb034b5b8186c15efae8a1751d7ee4e2820a6a674dfa874fac72c6d0ee79a8d949e4cf45',
    }
    const { getAdminCredentialStore } = await import('@/lib/server/admin-credential-store')
    const store = await getAdminCredentialStore()

    expect(await store.verify('LegacyPassw0rd!')).toBe(true)
    expect(await store.verify('WrongPassword!')).toBe(false)
  })
})

describe('production module no longer imports/calls scryptSync', () => {
  it('admin-credential-store.js source has no scryptSync reference', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(new URL('../lib/server/admin-credential-store.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/scryptSync/)
  })
})
