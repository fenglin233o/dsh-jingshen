import { afterEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ActivationService, type ActivationDetails } from '../src/activation.ts'
import { SelfChangeBook } from '../src/self-change.ts'

const directories: string[] = [], processes: { child: ChildProcess; exit: Promise<number | null> }[] = []
const supervisorScript = fileURLToPath(new URL('../scripts/run.mjs', import.meta.url))
const activationModule = pathToFileURL(fileURLToPath(new URL('../src/activation.ts', import.meta.url))).href
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean, failure = 'condition did not become true', timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (check()) return; await delay(25) }
  throw new Error(failure)
}
afterEach(async () => {
  for (const item of processes.splice(0)) {
    if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGTERM')
    await Promise.race([item.exit, delay(3000)])
    if (item.child.exitCode === null && item.child.signalCode === null) { item.child.kill('SIGKILL'); await item.exit }
  }
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-activation-'))
  directories.push(directory)
  const root = join(directory, 'plugin'), stateDir = join(directory, 'state'), log = join(directory, 'starts.log'), child = join(directory, 'fake-harness.mjs')
  mkdirSync(root); writeFileSync(join(root, 'version.txt'), 'one')
  writeFileSync(child, `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ActivationService } from ${JSON.stringify(activationModule)}
const version = readFileSync(join(process.argv[2], 'version.txt'), 'utf8')
appendFileSync(process.argv[3], version + '\\n')
if (version === 'broken') process.exit(9)
const bootDelay = join(process.env.SPIRIT_STATE_DIR, 'boot-delay-ms')
if (process.env.SPIRIT_ACTIVATION_REQUEST && existsSync(bootDelay)) {
  await new Promise(resolve => setTimeout(resolve, Number(readFileSync(bootDelay, 'utf8'))))
}
new ActivationService({ stateDir: process.env.SPIRIT_STATE_DIR }).ackBoot({ version })
setInterval(() => {}, 1000)
process.on('SIGTERM', () => {
  const drift = join(process.env.SPIRIT_STATE_DIR, 'drift-on-shutdown')
  if (existsSync(drift)) writeFileSync(join(process.argv[2], 'version.txt'), readFileSync(drift))
  process.exit(0)
})
`)
  const book = new SelfChangeBook({ stateDir, targets: [{ id: 'plugin', root, activation: 'plugin-reload' }] })
  const activation = new ActivationService({ stateDir, env: {} })
  return { directory, root, stateDir, log, child, book, activation }
}
async function candidate(f: ReturnType<typeof fixture>, value: string) {
  const record = f.book.begin({ reason: 'Check supervised loading of the changed version.', priorLimitations: 'The running child still reads the preceding version.',
    retainedContent: ['The owner-selected executable and its arguments'], criteria: ['The candidate contains the requested version.'], targets: ['plugin'] })
  writeFileSync(join(record.targets[0]!.candidateDirectory, 'version.txt'), value)
  const verified = await f.book.verify(record.id, [{ target: 'plugin', command: 'check the candidate version file' }], async request => ({
    exitCode: readFileSync(join(request.cwd, 'version.txt'), 'utf8') === value ? 0 : 1,
  }))
  expect(verified.state).toBe('verified')
  return { id: verified.id, details: { changeId: verified.id, targets: verified.targets.map(target => ({
    id: target.id, root: target.root, digest: verified.verified!.digests[target.id]!, required: target.activation,
  })) } satisfies ActivationDetails }
}
async function applyVersion(f: ReturnType<typeof fixture>, value: string) {
  const change = await candidate(f, value)
  await f.book.apply(change.id, () => {})
  return f.book.activationDetails(change.id)
}
function starts(f: ReturnType<typeof fixture>): string[] { return existsSync(f.log) ? readFileSync(f.log, 'utf8').trim().split('\n') : [] }
async function launch(f: ReturnType<typeof fixture>, pollMs = 50) {
  const child = spawn(process.execPath, [supervisorScript, '--state-dir', f.stateDir, '--poll-ms', String(pollMs),
    '--boot-timeout-ms', '2000', '--shutdown-timeout-ms', '250', '--', process.execPath, f.child, f.root, f.log], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SPIRIT_TEST_PRIVATE_VALUE: 'must-not-appear-in-records' },
  })
  let output = ''
  child.stdout?.on('data', value => { output += String(value) })
  child.stderr?.on('data', value => { output += String(value) })
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve))
  processes.push({ child, exit })
  await until(() => f.activation.snapshot().supervisor?.state === 'running', 'supervisor did not reach ready')
  const supervisor = f.activation.snapshot().supervisor!
  const service = new ActivationService({ stateDir: f.stateDir, env: { SPIRIT_STATE_DIR: f.stateDir, SPIRIT_SUPERVISOR_ID: supervisor.instanceId } })
  return { child, exit, service, supervisor, output: () => output }
}

describe('explicit activation of an owner-supervised Harness process', () => {
  it('requires applied files, restarts once, receives real boot acknowledgement and does not equate it with better behavior', async () => {
    const f = fixture(), running = await launch(f)
    expect(starts(f)).toEqual(['one'])
    const change = await candidate(f, 'two')
    expect(() => running.service.request(change.details)).toThrow(/fully applied/)
    await f.book.apply(change.id, () => {})
    const details = f.book.activationDetails(change.id), receipt = running.service.request(details)
    expect(receipt.status).toBe('requested')
    await until(() => running.service.read(receipt.id).status === 'runtime-loaded')
    expect(starts(f)).toEqual(['one', 'two'])
    const loaded = running.service.read(receipt.id)
    expect(loaded.runtime?.version).toBe('two')
    expect(loaded.history.map(item => item.status)).toEqual(['requested', 'restarting', 'booting', 'runtime-loaded'])
    expect(loaded.history.at(-1)?.detail).toContain('not behavioral improvement')
    expect(running.service.request(details).id).toBe(receipt.id)
    await delay(250)
    expect(starts(f)).toEqual(['one', 'two'])
    expect(JSON.stringify(running.service.snapshot())).not.toContain('must-not-appear-in-records')
    expect(running.output()).not.toContain('must-not-appear-in-records')
    running.child.kill('SIGTERM'); await running.exit
    expect(f.activation.snapshot().supervisor?.state).toBe('stopped')
    expect(starts(f)).toEqual(['one', 'two'])
  }, 15_000)

  it('keeps an unsupervised request inert until a new explicit request is made', async () => {
    const f = fixture(), details = await applyVersion(f, 'two')
    const inert = f.activation.request(details)
    expect(inert.status).toBe('restart-required')
    const running = await launch(f)
    await delay(150)
    expect(starts(f)).toEqual(['two'])
    expect(running.service.read(inert.id).status).toBe('restart-required')
    const requested = running.service.request(details)
    expect(requested.id).not.toBe(inert.id)
    await until(() => running.service.read(requested.id).status === 'runtime-loaded')
    expect(starts(f)).toEqual(['two', 'two'])
  }, 15_000)

  it('returns the existing activation receipt when the same request is retried during boot', async () => {
    const f = fixture(), running = await launch(f), details = await applyVersion(f, 'two')
    writeFileSync(join(f.stateDir, 'boot-delay-ms'), '500')
    const receipt = running.service.request(details)
    await until(() => running.service.read(receipt.id).status === 'booting')
    const retried = running.service.request(details)
    expect(retried.id).toBe(receipt.id)
    expect(retried.status).toBe('booting')
    expect(running.service.list()).toHaveLength(1)
    await until(() => running.service.read(receipt.id).status === 'runtime-loaded')
    expect(starts(f)).toEqual(['one', 'two'])
  }, 15_000)

  it('cancels queued activation and supervisor shutdown prevents relaunch', async () => {
    const f = fixture(), running = await launch(f, 500), details = await applyVersion(f, 'two')
    const cancelled = running.service.request(details)
    expect(running.service.cancelPending('本人暂停精神活动')).toContain(cancelled.id)
    expect(running.service.read(cancelled.id).status).toBe('cancelled')
    await delay(650)
    expect(starts(f)).toEqual(['one'])
    const requested = running.service.request(details)
    expect(requested.id).not.toBe(cancelled.id)
    running.child.kill('SIGTERM'); await running.exit
    expect(running.service.read(requested.id).status).toBe('cancelled')
    expect(starts(f)).toEqual(['one'])
  }, 15_000)

  it('reports a failed startup once and leaves the checkpoint available for independent recovery', async () => {
    const f = fixture(), running = await launch(f), details = await applyVersion(f, 'broken')
    const receipt = running.service.request(details)
    await running.exit
    expect(running.service.read(receipt.id).status).toBe('failed')
    expect(f.activation.snapshot().supervisor?.state).toBe('failed')
    expect(starts(f)).toEqual(['one', 'broken'])
    expect(readFileSync(join(f.book.read(details.changeId).targets[0]!.checkpointDirectory, 'version.txt'), 'utf8')).toBe('one')
    expect(running.output()).toContain('before Spirit acknowledged startup')
  }, 15_000)

  it('refuses later source edits and an acknowledgement from another launch', async () => {
    const f = fixture(), running = await launch(f), details = await applyVersion(f, 'two')
    writeFileSync(join(f.root, 'version.txt'), 'later-unverified')
    expect(() => running.service.request(details)).toThrow(/source changed/)
    const wrong = new ActivationService({ stateDir: f.stateDir, env: { SPIRIT_STATE_DIR: f.stateDir,
      SPIRIT_SUPERVISOR_ID: running.supervisor.instanceId, SPIRIT_BOOT_ID: randomUUID(), SPIRIT_ACTIVATION_REQUEST: randomUUID() } })
    expect(wrong.ackBoot({ version: 'invented' })).toBeUndefined()
    expect(starts(f)).toEqual(['one'])
  }, 15_000)

  it('rechecks a queued version before shutdown and leaves the old child running if source drifted', async () => {
    const f = fixture(), running = await launch(f, 500), details = await applyVersion(f, 'two')
    const receipt = running.service.request(details)
    writeFileSync(join(f.root, 'version.txt'), 'unverified-after-request')
    await until(() => running.service.read(receipt.id).status === 'failed')
    expect(f.activation.snapshot().supervisor?.state).toBe('running')
    expect(starts(f)).toEqual(['one'])
    expect(running.service.read(receipt.id).error).toContain('source changed')
  }, 15_000)

  it('waits for a real verification in another process context to release the shared source-operation lock', async () => {
    const f = fixture(), running = await launch(f), details = await applyVersion(f, 'two')
    const other = f.book.begin({ reason: 'An independent candidate is still being checked.', priorLimitations: 'Its verification has not finished.',
      criteria: ['The held verification must complete.'], targets: ['plugin'] })
    let release!: () => void, entered!: () => void
    const hold = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
    const verification = f.book.verify(other.id, [{ target: 'plugin', command: 'wait for the independent check' }], async () => {
      entered(); await hold; return { exitCode: 0 }
    })
    await started
    expect(JSON.parse(readFileSync(join(f.stateDir, 'self-changes', 'operation.lock'), 'utf8')).id).toBe(other.id)
    const receipt = running.service.request(details)
    try {
      await until(() => !!f.activation.snapshot().supervisor?.detail?.includes('waiting for the current source'))
      expect(starts(f)).toEqual(['one'])
      expect(running.service.read(receipt.id).status).toBe('requested')
      expect(f.activation.snapshot().supervisor?.state).toBe('running')
    } finally { release(); await verification }
    await until(() => running.service.read(receipt.id).status === 'runtime-loaded')
    expect(starts(f)).toEqual(['one', 'two'])
    await until(() => !existsSync(join(f.stateDir, 'self-changes', 'operation.lock')))
    expect(existsSync(join(f.stateDir, 'self-changes', 'operation.lock'))).toBe(false)
  }, 15_000)

  it('checks the version again after shutdown and refuses to spawn code changed by an exit hook', async () => {
    const f = fixture(), running = await launch(f), details = await applyVersion(f, 'two')
    writeFileSync(join(f.stateDir, 'drift-on-shutdown'), 'changed-by-shutdown-hook')
    const receipt = running.service.request(details)
    await running.exit
    expect(starts(f)).toEqual(['one'])
    expect(readFileSync(join(f.root, 'version.txt'), 'utf8')).toBe('changed-by-shutdown-hook')
    expect(running.service.read(receipt.id).status).toBe('failed')
    expect(running.service.read(receipt.id).history.map(item => item.status)).toEqual(['requested', 'restarting', 'failed'])
    expect(running.service.read(receipt.id).error).toContain('source changed')
    expect(existsSync(join(f.stateDir, 'self-changes', 'operation.lock'))).toBe(false)
  }, 15_000)

  it('does not signal a persisted PID or follow a replaced activation directory', () => {
    const f = fixture(), lock = join(f.stateDir, 'activation', 'supervisor.lock')
    const stale = { instanceId: randomUUID(), pid: process.pid }
    writeFileSync(lock, JSON.stringify(stale))
    const result = spawnSync(process.execPath, [supervisorScript, '--state-dir', f.stateDir, '--', process.execPath, f.child, f.root, f.log], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('supervisor lock already exists')
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual(stale)
    expect(starts(f)).toEqual([])
    const receipts = join(f.stateDir, 'activation', 'receipts'), elsewhere = join(f.directory, 'elsewhere')
    mkdirSync(elsewhere); rmSync(receipts, { recursive: true }); symlinkSync(elsewhere, receipts)
    expect(() => new ActivationService({ stateDir: f.stateDir })).toThrow(/not a real directory/)
  })
})
