import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SelfChangeBook, type SelfChangeRun, type SelfChangeRecord } from '../src/self-change.ts'

const cleanup: string[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(path => rmSync(path, { recursive: true, force: true })))
const reason = { reason: 'The current calculation fails the real example.', evidence: ['test.cjs expects double(2) to equal 4'],
  priorLimitations: 'The previous implementation returns its input; actual host activation remains untested.',
  retainedContent: ['Existing owner configuration and source history'], criteria: ['The executable regression test must pass.'], targets: ['plugin'] }
function fixture(withHarness = false) {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-self-change-'))
  cleanup.push(directory)
  const root = join(directory, 'plugin'), stateDir = join(directory, 'state'), host = join(directory, 'host')
  mkdirSync(root); mkdirSync(host)
  writeFileSync(join(root, 'app.cjs'), 'module.exports = value => value\n')
  writeFileSync(join(root, 'test.cjs'), "require('node:assert/strict').equal(require('./app.cjs')(2), 4)\n")
  writeFileSync(join(root, 'build.cjs'), "require('node:fs').copyFileSync('app.cjs', 'built.cjs')\n")
  writeFileSync(join(root, 'retained.txt'), 'owner data\n')
  writeFileSync(join(root, 'obsolete.txt'), 'obsolete\n')
  writeFileSync(join(host, 'host.cjs'), 'module.exports = 1\n')
  const targets = [{ id: 'plugin', root, activation: 'plugin-reload' as const }, ...(withHarness ? [{ id: 'harness', root: host, activation: 'host-restart' as const }] : [])]
  const book = new SelfChangeBook({ stateDir, targets })
  const change = book.begin({ ...reason, targets: withHarness ? ['plugin', 'harness'] : ['plugin'] })
  const candidate = change.targets[0]!.candidateDirectory, checkpoint = change.targets[0]!.checkpointDirectory
  return { directory, root, host, stateDir, targets, book, change, candidate, checkpoint }
}
function repair(f: ReturnType<typeof fixture>) { writeFileSync(join(f.candidate, 'app.cjs'), 'module.exports = value => value * 2\n') }
// Test runner substitutes for the Harness bridge. The production module cannot spawn processes.
const runNode: SelfChangeRun = async request => {
  const [binary, ...args] = request.command.split(' ')
  if (binary !== 'node') throw new Error('Test only supports direct node commands')
  const result = spawnSync(process.execPath, args, { cwd: request.cwd, encoding: 'utf8' })
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr }
}
const checks = [{ target: 'plugin', command: 'node test.cjs' }, { target: 'plugin', command: 'node build.cjs' }]
const authorize = vi.fn(async () => {})
const recordPath = (f: ReturnType<typeof fixture>) => join(f.stateDir, 'self-changes', f.change.id, 'record.json')
const recover = (f: ReturnType<typeof fixture>, apply = false, script = fileURLToPath(new URL('../scripts/spirit-recover.mjs', import.meta.url))) =>
  spawnSync(process.execPath, [script, f.stateDir, f.change.id, ...(apply ? ['--rollback'] : [])], { encoding: 'utf8' })

describe('real, recoverable changes to source and build artifacts', () => {
  it('checkpoints real files, records failed verification, applies tested artifacts and restores only journaled paths', async () => {
    const f = fixture(), original = readFileSync(join(f.root, 'app.cjs'), 'utf8')
    expect(readFileSync(f.change.recoveryScript, 'utf8')).toContain('Independent recovery')
    expect(readFileSync(join(f.checkpoint, 'app.cjs'), 'utf8')).toBe(original)
    const failed = await f.book.verify(f.change.id, checks, runNode)
    expect(failed.state).toBe('verification-failed')
    expect(failed.verifications[0]!.checks[0]!.exitCode).toBe(1)
    expect(failed.verifications[0]!.checks[0]!.stderr).toContain('AssertionError')
    await expect(f.book.apply(f.change.id, authorize)).rejects.toThrow(/successfully verified/)
    repair(f)
    rmSync(join(f.candidate, 'obsolete.txt'))
    writeFileSync(join(f.candidate, 'run.sh'), '#!/bin/sh\nexit 0\n'); chmodSync(join(f.candidate, 'run.sh'), 0o755)
    const verified = await f.book.verify(f.change.id, checks, runNode)
    expect(verified.state).toBe('verified')
    expect(verified.verifications).toHaveLength(2)
    expect(verified.verifications[0]!.passed).toBe(false)
    expect(verified.input).toMatchObject(reason)
    const delta = f.book.compare(f.change.id)
    expect(delta.differences.map(file => [file.path, file.kind])).toEqual([
      ['app.cjs', 'changed'], ['built.cjs', 'added'], ['obsolete.txt', 'removed'], ['run.sh', 'added'],
    ])
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).toBe(original)
    const approval = vi.fn(async request => { expect(request.operation).toBe('apply'); expect(request.targets[0].root).toBe(f.root) })
    const applied = await f.book.apply(f.change.id, approval)
    expect(approval).toHaveBeenCalledOnce(); expect(applied.state).toBe('applied')
    expect(readFileSync(join(f.root, 'built.cjs'), 'utf8')).toContain('value * 2')
    expect(statSync(join(f.root, 'run.sh')).mode & 0o777).toBe(0o755)
    expect(applied.activation).toEqual([{ target: 'plugin', required: 'plugin-reload', status: 'pending' }])
    expect(f.book.activationDetails(f.change.id)).toEqual({ changeId: f.change.id, targets: [{ id: 'plugin', root: f.root,
      digest: applied.verified!.digests.plugin, required: 'plugin-reload' }] })
    writeFileSync(join(f.root, 'retained.txt'), 'later unrelated owner edit\n')
    expect(() => f.book.activationDetails(f.change.id)).toThrow(/changed after apply/)
    writeFileSync(join(f.root, 'later.txt'), 'later unrelated addition\n')
    const restored = await f.book.rollback(f.change.id, authorize)
    expect(restored.state).toBe('rolled-back')
    expect(() => f.book.activationDetails(f.change.id)).toThrow(/completed application/)
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).toBe(original)
    expect(readFileSync(join(f.root, 'obsolete.txt'), 'utf8')).toBe('obsolete\n')
    expect(readFileSync(join(f.root, 'retained.txt'), 'utf8')).toBe('later unrelated owner edit\n')
    expect(existsSync(join(f.root, 'later.txt'))).toBe(true)
    expect(existsSync(join(f.root, 'built.cjs'))).toBe(false)
    expect(existsSync(join(f.root, 'run.sh'))).toBe(false)
    expect(restored.verifications[0]!.checks[0]!.exitCode).toBe(1)
    expect(f.book.list()[0]!.state).toBe('rolled-back')
  })

  it('persists changes of criteria with their antecedents; an experiment may acknowledge no prior evidence', () => {
    const f = fixture()
    const child = f.book.begin({ ...reason, parentId: f.change.id, evidence: [],
      criterionChanges: [{ previous: 'Only typechecking is sufficient', replacement: 'Run the failing runtime example too', reason: 'Types did not detect the wrong arithmetic.' }] })
    expect(child.input.parentId).toBe(f.change.id)
    expect(child.input.evidence).toEqual([])
    expect(child.input.criterionChanges[0]!.previous).toContain('typechecking')
    expect(f.book.read(f.change.id).input.criteria).toEqual(reason.criteria)
  })

  it('keeps bundled model files in a larger plugin checkpoint through verification, apply and rollback', async () => {
    const f = fixture(true)
    repair(f)
    await f.book.verify(f.change.id, [...checks, { target: 'harness', command: 'node --check host.cjs' }], runNode)
    await f.book.apply(f.change.id, authorize)

    const options = { stateDir: f.stateDir, targets: f.targets, defaultMaxBytesByTarget: { plugin: 8_192 } }
    const book = new SelfChangeBook(options)
    expect((await book.rollback(f.change.id, authorize)).state).toBe('rolled-back')

    const modelDirectory = 'media/voice/local/asr'
    mkdirSync(join(f.root, modelDirectory), { recursive: true })
    const paths = ['encoder.int8.onnx', 'weights-01.data'].map(file => `${modelDirectory}/${file}`)
    const original = Buffer.alloc(2_048, 42)
    for (const path of paths) writeFileSync(join(f.root, path), original)

    const change = book.begin(reason)
    const target = change.targets[0]!
    for (const path of paths) {
      expect(readFileSync(join(target.checkpointDirectory, path))).toEqual(original)
      expect(readFileSync(join(target.candidateDirectory, path))).toEqual(original)
    }
    writeFileSync(join(target.candidateDirectory, 'app.cjs'), 'module.exports = value => value * 2\n')
    expect((await book.verify(change.id, checks, runNode)).state).toBe('verified')
    expect((await book.apply(change.id, authorize)).state).toBe('applied')
    expect((await book.rollback(change.id, authorize)).state).toBe('rolled-back')
    for (const path of paths) expect(readFileSync(join(f.root, path))).toEqual(original)

    expect(() => new SelfChangeBook({ ...options, maxBytes: 1_024 }).begin(reason)).toThrow(/file\/byte limits/)
    expect(() => new SelfChangeBook({ ...options, defaultMaxBytesByTarget: { plugin: 1_024 } }).begin(reason)).toThrow(/file\/byte limits/)
    expect(() => new SelfChangeBook({ ...options, maxFiles: 1 }).begin(reason)).toThrow(/file\/byte limits/)

    const harnessFile = join(f.host, 'oversized')
    writeFileSync(harnessFile, '')
    truncateSync(harnessFile, 128 * 1024 * 1024 + 1)
    expect(() => book.begin({ ...reason, targets: ['harness'] })).toThrow(/file\/byte limits/)
  })

  it('refuses a candidate edited after verification, then permits real re-verification', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode)
    writeFileSync(join(f.candidate, 'extra.txt'), 'unverified source\n')
    const approval = vi.fn(async () => {})
    await expect(f.book.apply(f.change.id, approval)).rejects.toThrow(/changed after verification/)
    expect(approval).not.toHaveBeenCalled()
    await f.book.verify(f.change.id, checks, runNode)
    expect((await f.book.apply(f.change.id, approval)).state).toBe('applied')
  })

  it('detects changed live dependencies and rechecks after a native permission wait', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode)
    await expect(f.book.apply(f.change.id, async () => {
      writeFileSync(join(f.root, 'retained.txt'), 'edited while permission pending\n')
    })).rejects.toThrow(/Live source changed/)
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).not.toContain('value * 2')
    expect(f.book.read(f.change.id).application).toBeUndefined()
  })

  it('does not perform live mutations when authorization is denied or missing', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode)
    await expect(f.book.apply(f.change.id, async () => { throw new Error('Permission denied') })).rejects.toThrow('Permission denied')
    await expect(f.book.apply(f.change.id, undefined as never)).rejects.toThrow(/authorization callback/)
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).not.toContain('value * 2')
    const denied = await f.book.verify(f.change.id, checks, async () => { throw new Error('Shell permission denied') })
    expect(denied.state).toBe('verification-failed')
    expect(denied.verifications.at(-1)!.checks[0]!.exitCode).toBeNull()
    expect(denied.verifications.at(-1)!.error).toContain('Shell permission denied')
  })

  it('refuses all rollback writes on a later-edit conflict, including a new file', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode); await f.book.apply(f.change.id, authorize)
    writeFileSync(join(f.root, 'built.cjs'), 'later build not produced by this candidate\n')
    const approval = vi.fn(async () => {})
    await expect(f.book.rollback(f.change.id, approval)).rejects.toThrow(/Later edits conflict/)
    expect(approval).not.toHaveBeenCalled()
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).toContain('value * 2')
    expect(f.book.read(f.change.id).state).toBe('rollback-conflict')
    copyFileSync(join(f.candidate, 'built.cjs'), join(f.root, 'built.cjs'))
    expect((await f.book.rollback(f.change.id, authorize)).state).toBe('rolled-back')
  })

  it('refuses a changed checkpoint instead of trusting a narrative that recovery succeeded', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode); await f.book.apply(f.change.id, authorize)
    writeFileSync(join(f.checkpoint, 'app.cjs'), 'corrupt baseline\n')
    await expect(f.book.rollback(f.change.id, authorize)).rejects.toThrow(/Checkpoint was changed/)
    const recovery = recover(f, true)
    expect(recovery.status).toBe(1); expect(recovery.stderr).toContain('Checkpoint was changed')
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).toContain('value * 2')
  })

  it('recovers after process interruption using an independent copied script and incomplete journal statuses', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode); await f.book.apply(f.change.id, authorize)
    const record: SelfChangeRecord = JSON.parse(readFileSync(recordPath(f), 'utf8'))
    record.state = 'applying'; delete record.application!.completedAt
    record.application!.files.forEach(entry => { entry.state = 'pending' }) // Simulate crash between rename and journal acknowledgement.
    writeFileSync(recordPath(f), JSON.stringify(record))
    rmSync(join(f.root, 'built.cjs')) // The next journaled mutation was never reached.
    const script = f.change.recoveryScript
    rmSync(f.candidate, { recursive: true, force: true }) // Broken/missing candidate and plugin bundles are not needed for recovery.
    const inspected = recover(f, false, script)
    expect(inspected.status).toBe(0)
    expect(JSON.parse(inspected.stdout).files.map((entry: { status: string }) => entry.status)).toEqual(['applied', 'original'])
    const recovered = recover(f, true, script)
    expect(recovered.stderr).toBe(''); expect(recovered.status).toBe(0)
    expect(JSON.parse(recovered.stdout).state).toBe('rolled-back')
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).not.toContain('value * 2')
    expect(existsSync(join(f.root, 'built.cjs'))).toBe(false)
    expect(f.book.read(f.change.id).history.at(-1)!.detail).toContain('Independent recovery')
  })

  it('the recovery script detects later edits and retains every original failure record', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode); await f.book.apply(f.change.id, authorize)
    writeFileSync(join(f.root, 'app.cjs'), 'owner hotfix\n')
    const recovery = recover(f, true)
    expect(recovery.status).toBe(1); expect(recovery.stderr).toContain('Later edits conflict')
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).toBe('owner hotfix\n')
    expect(f.book.read(f.change.id).state).toBe('rollback-conflict')
  })

  it('distinguishes plugin reload from Harness restart and requires verification of both roots', async () => {
    const f = fixture(true); repair(f)
    writeFileSync(join(f.change.targets[1]!.candidateDirectory, 'host.cjs'), 'module.exports = 2\n')
    await expect(f.book.verify(f.change.id, checks, runNode)).rejects.toThrow(/Every selected target/)
    await f.book.verify(f.change.id, [...checks, { target: 'harness', command: 'node --check host.cjs' }], runNode)
    const applied = await f.book.apply(f.change.id, authorize)
    expect(applied.state).toBe('applied')
    expect(applied.activation.map(item => item.required)).toEqual(['plugin-reload', 'host-restart'])
    expect(readFileSync(join(f.host, 'host.cjs'), 'utf8')).toContain('= 2')
    expect((await f.book.rollback(f.change.id, authorize)).state).toBe('rolled-back')
    expect(readFileSync(join(f.host, 'host.cjs'), 'utf8')).toContain('= 1')
  })

  it('does not race another in-flight verification in the same state directory', async () => {
    const f = fixture(); repair(f)
    const second = f.book.begin(reason)
    let finish!: () => void
    const waiting = new Promise<void>(resolve => { finish = resolve })
    const verify = f.book.verify(f.change.id, [{ target: 'plugin', command: 'native check' }], async () => { await waiting; return { exitCode: 0 } })
    const other = new SelfChangeBook({ stateDir: f.stateDir, targets: f.targets })
    await expect(other.verify(f.change.id, checks, runNode)).rejects.toThrow(/already active/)
    await expect(other.verify(second.id, checks, runNode)).rejects.toThrow(/already active/)
    finish(); expect((await verify).state).toBe('verified')
  })

  it('retains readable history when installation roots move, while refusing mutation through the stale target', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode); await f.book.apply(f.change.id, authorize)
    const movedRoot = join(f.directory, 'replacement-install'); mkdirSync(movedRoot)
    const moved = new SelfChangeBook({ stateDir: f.stateDir, targets: [{ id: 'plugin', root: movedRoot, activation: 'plugin-reload' }] })
    rmSync(f.root, { recursive: true, force: true })
    expect(moved.read(f.change.id).input.reason).toBe(reason.reason)
    expect(moved.list()[0]!.state).toBe('applied')
    expect(() => moved.compare(f.change.id)).toThrow(/Target configuration changed/)
    expect(() => moved.activationDetails(f.change.id)).toThrow(/Target configuration changed/)
    await expect(moved.rollback(f.change.id, authorize)).rejects.toThrow(/Target configuration changed/)
    expect(moved.read(f.change.id).history.at(-1)!.event).toBe('rollback-conflict')
    expect(existsSync(join(movedRoot, 'app.cjs'))).toBe(false)
  })

  it('never steals an abandoned lock or uses its saved PID as authority to mutate files', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode); await f.book.apply(f.change.id, authorize)
    const lockPath = join(f.stateDir, 'self-changes', 'operation.lock'), abandoned = JSON.stringify({ pid: 2_147_483_647, id: f.change.id })
    writeFileSync(lockPath, abandoned)
    await expect(f.book.rollback(f.change.id, authorize)).rejects.toThrow(/inspect and remove/)
    const attempted = recover(f, true)
    expect(attempted.status).toBe(1); expect(attempted.stderr).toContain('inspect and remove')
    expect(readFileSync(lockPath, 'utf8')).toBe(abandoned)
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).toContain('value * 2')
    // Test setup represents the owner having stopped all participants and inspected the lock.
    rmSync(lockPath)
    expect((await f.book.rollback(f.change.id, authorize)).state).toBe('rolled-back')
  })

  it.skipIf(process.getuid?.() === 0)('journals an actual partial filesystem failure and can restore the files already changed', async () => {
    const f = fixture()
    mkdirSync(join(f.root, 'z-locked'))
    writeFileSync(join(f.root, 'z-locked', 'source.cjs'), 'original\n')
    const change = f.book.begin(reason), candidate = change.targets[0]!.candidateDirectory
    writeFileSync(join(candidate, 'app.cjs'), 'module.exports = value => value * 2\n')
    writeFileSync(join(candidate, 'z-locked', 'source.cjs'), 'changed\n')
    await f.book.verify(change.id, checks, runNode)
    try {
      const applied = await f.book.apply(change.id, async () => { chmodSync(join(f.root, 'z-locked'), 0o500) })
      expect(applied.state).toBe('apply-failed')
      expect(applied.application!.files.some(entry => entry.state === 'written')).toBe(true)
      expect(applied.application!.files.at(-1)!.state).toBe('pending')
      expect(applied.history.at(-1)!.detail).toContain('partial file changes may exist')
    } finally { chmodSync(join(f.root, 'z-locked'), 0o700) }
    expect((await f.book.rollback(change.id, authorize)).state).toBe('rolled-back')
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).not.toContain('value * 2')
    expect(readFileSync(join(f.root, 'z-locked', 'source.cjs'), 'utf8')).toBe('original\n')
  })
})

describe('source and candidate path boundaries', () => {
  it('rejects traversal, symlinks and unconfigured roots without writing outside the source tree', async () => {
    const f = fixture(); repair(f)
    await expect(f.book.verify(f.change.id, [{ target: 'plugin', command: 'node test.cjs', cwd: '../' }], runNode)).rejects.toThrow(/Unsafe relative path/)
    expect(() => f.book.begin({ ...reason, targets: ['unknown'] })).toThrow(/not configured/)
    const outside = join(f.directory, 'outside.txt'); writeFileSync(outside, 'must remain unchanged\n')
    symlinkSync(outside, join(f.candidate, 'escape.txt'))
    expect(() => f.book.compare(f.change.id)).toThrow(/Symlinks/)
    expect(readFileSync(outside, 'utf8')).toBe('must remain unchanged\n')
    rmSync(join(f.candidate, 'escape.txt'))
    mkdirSync(join(f.candidate, 'folder')); writeFileSync(join(f.candidate, 'folder', 'child.txt'), 'new\n')
    await f.book.verify(f.change.id, checks, runNode)
    symlinkSync(f.directory, join(f.root, 'folder'))
    await expect(f.book.apply(f.change.id, authorize)).rejects.toThrow(/Symlinks/)
    expect(existsSync(join(f.directory, 'child.txt'))).toBe(false)
  })

  it('excludes dependency and git trees while retaining source artifacts and file mode changes', async () => {
    const f = fixture()
    mkdirSync(join(f.root, '.git')); writeFileSync(join(f.root, '.git', 'config'), 'ignored\n')
    symlinkSync(f.host, join(f.root, 'node_modules'))
    const change = f.book.begin(reason), candidate = change.targets[0]!.candidateDirectory
    expect(existsSync(join(candidate, '.git'))).toBe(false); expect(existsSync(join(candidate, 'node_modules'))).toBe(false)
    chmodSync(join(candidate, 'app.cjs'), 0o700)
    const delta = f.book.compare(change.id).differences
    expect(delta).toHaveLength(1); expect(delta[0]!.before!.sha256).toBe(delta[0]!.after!.sha256)
    expect(delta[0]!.after!.mode).toBe(0o700)
  })

  it('rejects overlapping roots and state embedded in editable source', () => {
    const f = fixture()
    expect(() => new SelfChangeBook({ stateDir: join(f.root, 'private-state'), targets: f.targets })).toThrow(/outside every source root/)
    expect(() => new SelfChangeBook({ stateDir: f.stateDir, targets: [...f.targets, { id: 'nested', root: f.root, activation: 'host-restart' }] })).toThrow(/must not overlap/)
  })

  it('rejects a file-to-directory migration before changing any live file', async () => {
    const f = fixture(); repair(f)
    rmSync(join(f.candidate, 'obsolete.txt')); mkdirSync(join(f.candidate, 'obsolete.txt'))
    writeFileSync(join(f.candidate, 'obsolete.txt', 'child.txt'), 'new\n')
    await f.book.verify(f.change.id, checks, runNode)
    await expect(f.book.apply(f.change.id, authorize)).rejects.toThrow(/non-directory parent/)
    expect(readFileSync(join(f.root, 'app.cjs'), 'utf8')).not.toContain('value * 2')
    expect(f.book.read(f.change.id).application).toBeUndefined()
  })

  it('rejects an application journal path changed to traverse outside the source root', async () => {
    const f = fixture(); repair(f)
    await f.book.verify(f.change.id, checks, runNode); await f.book.apply(f.change.id, authorize)
    const record: SelfChangeRecord = JSON.parse(readFileSync(recordPath(f), 'utf8'))
    record.application!.files[0]!.path = '../outside.txt'
    writeFileSync(recordPath(f), JSON.stringify(record))
    await expect(f.book.rollback(f.change.id, authorize)).rejects.toThrow(/Unsafe relative path/)
    expect(recover(f, true).status).toBe(1)
  })
})
