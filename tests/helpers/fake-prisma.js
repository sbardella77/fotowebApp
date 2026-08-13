import { vi } from 'vitest'

// Test-only in-memory Prisma fake with real commit/rollback semantics for
// $transaction. NOT a general-purpose database emulator: no row locks, no
// MVCC, no isolation levels — just enough to prove that a thrown error
// inside a transaction callback discards every write attempted in it, and
// that a resolved callback commits all of them together. That's the one
// property STEP 4 atomicity depends on.
//
// Design:
//   - Each model is a `table`: a live, mutable array of plain-object rows
//     plus vi.fn()-wrapped find/create/update/updateMany methods closing
//     over that array.
//   - The root client's tables are the source of truth.
//   - $transaction(fn) clones every root table's rows into a brand-new,
//     independent set of tables (the "snapshot"), builds a `tx` client over
//     that snapshot, and runs `fn(tx)`.
//   - Reads/writes inside `fn` only ever touch the snapshot tables, so the
//     transaction sees its own writes immediately (same array, mutated in
//     place) while the root stays untouched — cheap "isolation" via object
//     identity, not real MVCC.
//   - If `fn` resolves: each root table's contents are replaced in place
//     (same array reference, new contents) with the snapshot's final rows —
//     an atomic "commit".
//   - If `fn` throws: the merge step is never reached: the root's arrays
//     were never touched, so the rejection alone is the rollback.

const MODEL_CONFIGS = {
  owner: { autoId: (n) => `owner-fake-${n}` },
  event: { autoId: (n) => `event-fake-${n}` },
  upsellEvent: { autoId: (n) => `upsell-fake-${n}` },
  extraFreeEventCheckout: { autoId: (n) => `checkout-fake-${n}` },
  stripeWebhookEvent: { autoId: (n) => `swe-fake-${n}`, uniqueFields: ['eventId'] },
}

function cloneRecords(records) {
  return records.map((r) => ({ ...r }))
}

function matchesClause(record, clause) {
  if (clause.OR) {
    return clause.OR.some((sub) => matchesClause(record, sub))
  }
  return Object.entries(clause).every(([key, expected]) => record[key] === expected)
}

function applyData(record, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) {
      record[key] = (record[key] || 0) + value.increment
    } else {
      record[key] = value
    }
  }
}

function createTable({ records = [], idField = 'id', autoId, uniqueFields = [] }) {
  const rows = cloneRecords(records)

  function findMatch(where = {}) {
    return rows.find((r) => matchesClause(r, where))
  }

  return {
    _rows: rows,
    _replaceAll(newRows) {
      rows.length = 0
      rows.push(...cloneRecords(newRows))
    },
    findFirst: vi.fn(async ({ where = {} } = {}) => {
      const found = findMatch(where)
      return found ? { ...found } : null
    }),
    findUnique: vi.fn(async ({ where = {} } = {}) => {
      const found = findMatch(where)
      return found ? { ...found } : null
    }),
    create: vi.fn(async ({ data }) => {
      for (const field of uniqueFields) {
        if (data[field] !== undefined && rows.some((r) => r[field] === data[field])) {
          const err = new Error(`Unique constraint failed on the fields: (\`${field}\`)`)
          err.code = 'P2002'
          throw err
        }
      }
      const row = { ...data, [idField]: data[idField] ?? autoId(rows.length + 1) }
      rows.push(row)
      return { ...row }
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = findMatch(where)
      if (!row) {
        const err = new Error('Record to update not found.')
        err.code = 'P2025'
        throw err
      }
      applyData(row, data)
      return { ...row }
    }),
    updateMany: vi.fn(async ({ where = {}, data }) => {
      let count = 0
      for (const row of rows) {
        if (!matchesClause(row, where)) continue
        applyData(row, data)
        count += 1
      }
      return { count }
    }),
  }
}

function buildTables(seed = {}) {
  const tables = {}
  for (const [model, config] of Object.entries(MODEL_CONFIGS)) {
    tables[model] = createTable({
      records: seed[model] || [],
      autoId: config.autoId,
      uniqueFields: config.uniqueFields || [],
    })
  }
  return tables
}

function clientFromTables(tables) {
  const client = {}
  for (const model of Object.keys(MODEL_CONFIGS)) {
    client[model] = tables[model]
  }
  client.$queryRaw = vi.fn().mockResolvedValue([])
  return client
}

// seed: { owner: [...], event: [...], upsellEvent: [...], extraFreeEventCheckout: [...], stripeWebhookEvent: [...] }
export function createFakeTransactionalPrisma(seed = {}) {
  const rootTables = buildTables(seed)
  const rootClient = clientFromTables(rootTables)

  rootClient.$transaction = vi.fn(async (fn) => {
    const snapshotSeed = {}
    for (const model of Object.keys(MODEL_CONFIGS)) {
      snapshotSeed[model] = rootTables[model]._rows
    }
    const txTables = buildTables(snapshotSeed)
    const txClient = clientFromTables(txTables)

    const result = await fn(txClient)

    // Commit: only reached if `fn` resolved. Replace each root table's
    // contents (same array reference) with the snapshot's final rows.
    for (const model of Object.keys(MODEL_CONFIGS)) {
      rootTables[model]._replaceAll(txTables[model]._rows)
    }
    return result
  })

  return rootClient
}
