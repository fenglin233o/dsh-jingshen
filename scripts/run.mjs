#!/usr/bin/env node
/** Supervise exactly the command supplied by the owner; explicit activation receipts alone request restarts. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { activationPaths, assertAppliedChange, listReceipts, readJSON, receiptState, recordPath, stamp, trySourceOperationLock, writeJSON } from './activation-protocol.mjs'

function options(argv) {
  const result = { stateDir: process.env.SPIRIT_STATE_DIR, pollMs: 250, bootTimeoutMs: 60_000, shutdownTimeoutMs: 10_000, command: [] }
  const numeric = { '--poll-ms': ['pollMs', 25, 1000], '--boot-timeout-ms': ['bootTimeoutMs', 250, 600_000],
    '--shutdown-timeout-ms': ['shutdownTimeoutMs', 100, 60_000] }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--') { result.command = argv.slice(i + 1); break }
    if (key === '--help') {
      console.log('Usage: node scripts/run.mjs --state-dir /absolute/state -- executable [arguments...]\nSPIRIT_STATE_DIR may supply the state directory. Stop with Ctrl-C. Only explicit Spirit activation requests cause a restart.')
      process.exit(0)
    }
    if (key === '--state-dir') { result.stateDir = argv[++i]; continue }
    if (!numeric[key]) throw new Error('Unknown supervisor option; use --help')
    const [field, low, high] = numeric[key], value = Number(argv[++i])
    if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error(`Invalid ${key}`)
    result[field] = value
  }
  if (!result.stateDir || !isAbsolute(result.stateDir) || !result.command.length) throw new Error('Provide an absolute state directory and an explicit executable after --')
  return result
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let child, childOutcome, stopped = false, paths, state, activeReceipt, ownedLock = false
const stop = () => { stopped = true }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
const publish = changes => {
  state = { ...state, ...changes, updatedAt: stamp() }
  writeJSON(paths.supervisor, state)
}
async function stopChild(timeout) {
  if (!child || childOutcome) return
  // Only this in-memory child handle is signaled. A saved PID never authorizes killing a process.
  child.kill('SIGTERM')
  const until = Date.now() + timeout
  while (!childOutcome && Date.now() < until) { publish({}); await delay(25) }
  if (!childOutcome) {
    child.kill('SIGKILL')
    const hardLimit = Date.now() + 2000
    while (!childOutcome && Date.now() < hardLimit) { publish({}); await delay(25) }
  }
  if (!childOutcome) throw new Error('The previous child did not stop; a second child was not started')
}
function cancelQueued(reason) {
  for (const receipt of listReceipts(paths)) if (receipt.supervisorId === state.instanceId && receipt.status === 'requested') {
    receiptState(paths, receipt, 'cancelled', reason)
  }
}
async function boot(config, receipt) {
  if (stopped) return
  // Shutdown hooks or non-cooperating external writers may have changed files after the first check.
  // Refuse to execute that version, even though the previous child has now exited.
  if (receipt) assertAppliedChange(paths, receipt)
  const bootId = randomUUID()
  if (receipt) activeReceipt = receiptState(paths, receipt, 'booting', 'Starting the exact owner-selected command with the applied version.',
    { bootId, restartedAt: stamp() })
  publish({ state: receipt ? 'restarting' : 'starting', bootId, requestId: receipt?.id, childPid: undefined, detail: undefined })
  childOutcome = undefined
  child = spawn(config.command[0], config.command.slice(1), {
    shell: false, stdio: 'inherit', env: { ...process.env, SPIRIT_STATE_DIR: paths.stateDir,
      SPIRIT_SUPERVISOR_ID: state.instanceId, SPIRIT_BOOT_ID: bootId, SPIRIT_ACTIVATION_REQUEST: receipt?.id ?? '' },
  })
  child.once('error', error => { childOutcome = { error: error.message } })
  child.once('exit', (code, signal) => { childOutcome = { code, signal } })
  publish({ childPid: child.pid })
  const deadline = Date.now() + config.bootTimeoutMs
  while (!stopped) {
    if (childOutcome) throw new Error(`Child exited before Spirit acknowledged startup (${childOutcome.error ?? childOutcome.code ?? childOutcome.signal})`)
    const acknowledgement = readJSON(recordPath(paths.acknowledgements, bootId), true)
    if (acknowledgement) {
      if (acknowledgement.schema !== 1 || acknowledgement.bootId !== bootId || acknowledgement.supervisorId !== state.instanceId
        || acknowledgement.requestId !== receipt?.id || !Number.isSafeInteger(acknowledgement.runtime?.pid)
        || acknowledgement.runtime.pid < 1) throw new Error('Invalid boot acknowledgement')
      if (receipt) {
        assertAppliedChange(paths, receipt)
        activeReceipt = receiptState(paths, activeReceipt, 'runtime-loaded',
          'Spirit acknowledged readiness after restart. This records runtime loading, not behavioral improvement.',
          { loadedAt: acknowledgement.at, runtime: acknowledgement.runtime })
      }
      publish({ state: 'running', requestId: undefined, detail: 'Spirit startup acknowledged.' })
      return
    }
    if (Date.now() >= deadline) throw new Error('Spirit did not acknowledge startup before the boot deadline; no automatic retry will run')
    publish({}); await delay(config.pollMs)
  }
}

let config
try {
  config = options(process.argv.slice(2))
  paths = activationPaths(config.stateDir)
  state = { schema: 1, instanceId: randomUUID(), pid: process.pid, state: 'starting', startedAt: stamp(), updatedAt: stamp() }
  try { writeJSON(paths.lock, { schema: 1, instanceId: state.instanceId, pid: process.pid, createdAt: stamp() }, true); ownedLock = true }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('A supervisor lock already exists. Stop the existing supervisor; after a crash, inspect the lock and confirm no supervisor is running before removing it. No saved PID will be killed automatically.')
    throw error
  }
  publish({})
  // Old requests are never replayed under a different supervisor instance.
  for (const receipt of listReceipts(paths)) if (receipt.supervisorId !== state.instanceId && ['requested', 'restarting', 'booting'].includes(receipt.status)) {
    receiptState(paths, receipt, 'failed', 'The previous supervisor ended before confirming activation. Inspect the result and make a new explicit request.')
  }
  await boot(config)
  while (!stopped) {
    if (childOutcome) throw new Error(`Harness child exited (${childOutcome.error ?? childOutcome.code ?? childOutcome.signal}); automatic restart is disabled`)
    let receipt = listReceipts(paths).find(item => item.supervisorId === state.instanceId && item.status === 'requested')
    if (receipt) {
      const cancellation = readJSON(recordPath(paths.cancellations, receipt.id), true)
      if (cancellation) { receiptState(paths, receipt, 'cancelled', cancellation.reason); continue }
      const release = trySourceOperationLock(paths, receipt.changeId, state.instanceId)
      if (!release) {
        publish({ detail: 'Activation is waiting for the current source verification, mutation or recovery operation to release its lock.' })
        await delay(config.pollMs); continue
      }
      try {
        try { assertAppliedChange(paths, receipt) }
        catch (error) { receiptState(paths, receipt, 'failed', 'Applied source no longer matches the requested verified version.', { error: String(error) }); continue }
        // Cancellation can arrive during a source scan. Honor it before starting shutdown.
        const lastCancellation = readJSON(recordPath(paths.cancellations, receipt.id), true)
        if (lastCancellation) { receiptState(paths, receipt, 'cancelled', lastCancellation.reason); continue }
        if (stopped) break
        receipt = receiptState(paths, receipt, 'restarting', 'Explicit activation accepted; stopping the previous child once.')
        activeReceipt = receipt
        publish({ state: 'restarting', requestId: receipt.id, detail: undefined })
        await stopChild(config.shutdownTimeoutMs)
        if (stopped) break
        await boot(config, receipt)
      } finally { release() }
    }
    publish({}); await delay(config.pollMs)
  }
  if (activeReceipt && ['restarting', 'booting'].includes(activeReceipt.status)) {
    activeReceipt = receiptState(paths, activeReceipt, 'cancelled', 'The owner stopped the supervisor before startup was confirmed.')
  }
  cancelQueued('The owner stopped the supervisor; queued activation will not run later.')
  await stopChild(config.shutdownTimeoutMs)
  publish({ state: 'stopped', childPid: undefined, detail: 'Supervisor stopped; no child will be relaunched.' })
} catch (error) {
  // Never print argv, environment variables or child output in diagnostic records.
  const message = error instanceof Error ? error.message : 'Supervisor failed'
  console.error(`Spirit supervisor: ${message}`)
  if (ownedLock) {
    if (activeReceipt && ['restarting', 'booting'].includes(activeReceipt.status)) {
      activeReceipt = receiptState(paths, activeReceipt, 'failed', 'The requested version did not acknowledge a successful startup.', { error: message })
    }
    try { cancelQueued('Supervisor failed; no queued activation will be retried automatically.') } catch {}
    try { await stopChild(config?.shutdownTimeoutMs ?? 1000) } catch {}
    try { publish({ state: 'failed', childPid: undefined, detail: message }) } catch {}
  }
  process.exitCode = 1
} finally {
  process.off('SIGINT', stop); process.off('SIGTERM', stop)
  if (ownedLock) {
    try { if (readJSON(paths.lock, true)?.instanceId === state.instanceId) unlinkSync(paths.lock) } catch {}
  }
}
