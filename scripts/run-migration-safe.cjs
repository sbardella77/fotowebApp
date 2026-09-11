'use strict'

const { spawn } = require('node:child_process')
const preflight = require('./db-migration-preflight.cjs')

function parseArgs(argv) {
  let environment = null
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--env') {
      environment = argv[index + 1] || null
      index += 1
    }
  }
  return { environment }
}

function spawnMigration() {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['prisma', 'migrate', 'deploy'], {
      stdio: 'inherit',
      env: process.env,
      shell: false,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) return resolve(128)
      resolve(Number.isInteger(code) ? code : 1)
    })
  })
}

async function runSafeMigration({
  environment,
  directUrl = process.env.DIRECT_URL,
  createExecutor = preflight.createPrismaExecutor,
  executeMigration = spawnMigration,
  output = console.log,
}) {
  const connectionCheck = preflight.validateConnectionIdentity(environment, directUrl)
  if (!connectionCheck.ok) {
    for (const line of preflight.machineLines(connectionCheck)) output(line)
    output('MIGRATION_EXECUTED=NO')
    return 2
  }

  let executor
  try {
    executor = createExecutor(directUrl)
    const result = await preflight.runPreflight({
      environment,
      directUrl,
      query: executor.query.bind(executor),
    })

    for (const line of preflight.machineLines(result)) output(line)
    if (!result.ok) {
      output('MIGRATION_EXECUTED=NO')
      return 3
    }

    output('MIGRATION_EXECUTION=AUTHORIZED_BY_PREFLIGHT')
    const migrationCode = await executeMigration()
    output('MIGRATION_EXECUTED=YES')
    return migrationCode
  } catch {
    output('MIGRATION_PREFLIGHT=FAIL')
    output('REASON=WRAPPER_INTERNAL_FAILURE')
    output('MIGRATION_EXECUTED=NO')
    return 4
  } finally {
    if (executor) {
      try {
        await executor.disconnect()
      } catch {
        // Never serialize connection/provider diagnostics.
      }
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const { environment } = parseArgs(argv)
  return runSafeMigration({ environment })
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code
  })
}

module.exports = {
  parseArgs,
  spawnMigration,
  runSafeMigration,
  main,
}
