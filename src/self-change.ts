/** Observable, recoverable source changes. Commands and activation remain Harness operations. */
import { createHash, randomUUID } from 'node:crypto'
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const prose = z.string().trim().min(1).max(16000)
const targetId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
export const SelfChangeBeginInput = z.object({
  reason: prose,
  evidence: z.array(prose).max(128).default([]),
  priorLimitations: prose,
  retainedContent: z.array(prose).max(128).default([]),
  criteria: z.array(prose).min(1).max(64),
  criterionChanges: z.array(z.object({ previous: prose, replacement: prose, reason: prose }).strict()).max(64).default([]),
  targets: z.array(targetId).min(1).max(8),
  parentId: z.uuid().optional(),
}).strict()
export const SelfChangeCheckInput = z.object({ target: targetId, command: prose, cwd: z.string().max(4096).optional() }).strict()
export interface SelfChangeTarget {
  id: string
  root: string
  label?: string
  activation: 'plugin-reload' | 'host-restart'
  /** Relative subtree paths, in addition to .git and node_modules at any depth. */
  exclude?: string[]
}
export interface SelfChangeOptions {
  stateDir: string
  targets: SelfChangeTarget[]
  maxFiles?: number
  maxBytes?: number
}
export interface SelfChangeCommand {
  id: string; target: string; command: string; cwd: string
}
export interface SelfChangeCommandResult {
  exitCode: number | null; stdout?: string; stderr?: string
}
/** The caller must execute through Harness's native permission boundary, never a raw subprocess bridge. */
export type SelfChangeRun = (command: SelfChangeCommand) => Promise<SelfChangeCommandResult>
export interface SelfChangeMutation {
  id: string; operation: 'apply' | 'rollback'
  targets: { id: string; root: string; paths: string[] }[]
}
/** Required even when the calling Harness tool has already obtained authorization. */
export type SelfChangeAuthorize = (mutation: SelfChangeMutation) => Promise<void> | void
export interface SelfChangeActivationDetails {
  changeId: string
  targets: { id: string; root: string; digest: string; required: SelfChangeTarget['activation'] }[]
}
export interface SelfChangeFile { sha256: string; size: number; mode: number }
export type SelfChangeManifest = Record<string, SelfChangeFile>
export interface SelfChangeSnapshot extends SelfChangeTarget {
  root: string; exclude: string[]; checkpointDirectory: string; candidateDirectory: string
  baseline: SelfChangeManifest; baselineDigest: string
}
export interface SelfChangeDifference {
  target: string; path: string; kind: 'added' | 'changed' | 'removed'
  before?: SelfChangeFile; after?: SelfChangeFile
}
export interface SelfChangeVerification {
  startedAt: string; finishedAt?: string; passed: boolean
  before: Record<string, string>; after?: Record<string, string>
  checks: (SelfChangeCommand & SelfChangeCommandResult & { outputTruncated?: boolean; error?: string })[]
  error?: string
}
export interface SelfChangeJournal {
  startedAt: string; completedAt?: string; rolledBackAt?: string
  files: (SelfChangeDifference & { state: 'pending' | 'written' | 'restored' })[]
}
export interface SelfChangeRecord {
  schema: 1; id: string; createdAt: string
  recoveryScript: string
  input: z.infer<typeof SelfChangeBeginInput>
  targets: SelfChangeSnapshot[]
  state: 'candidate' | 'checkpoint-failed' | 'verifying' | 'verified' | 'verification-failed' | 'applying' | 'apply-failed'
    | 'applied' | 'rolling-back' | 'rollback-conflict' | 'rollback-failed' | 'rolled-back'
  verifications: SelfChangeVerification[]
  verified?: { attempt: number; digests: Record<string, string> }
  application?: SelfChangeJournal
  /** Filesystem application is not proof that the running plugin/host has loaded the new version. */
  activation: { target: string; required: SelfChangeTarget['activation']; status: 'pending' }[]
  history: { at: string; event: string; detail: string }[]
}

const stamp = () => new Date().toISOString()
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const same = (a?: SelfChangeFile, b?: SelfChangeFile) => a?.sha256 === b?.sha256 && a?.size === b?.size && a?.mode === b?.mode
const owns = (manifest: SelfChangeManifest, path: string) => Object.hasOwn(manifest, path) ? manifest[path] : undefined
const digest = (manifest: SelfChangeManifest) => hash(JSON.stringify(Object.keys(manifest).sort()
  .map(path => [path, manifest[path]!.sha256, manifest[path]!.size, manifest[path]!.mode])))
const inDirectory = (root: string, path: string) => path === root || path.startsWith(root + sep)
function pathParts(path: string): string[] {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe relative path: ${path}`)
  }
  return path.split('/')
}
function checkedRoot(root: string): void {
  if (!isAbsolute(root) || realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw new Error(`Source root moved or is not a real directory: ${root}`)
}
/** Do not follow a changed parent symlink, including when adding a previously absent file. */
function filePath(root: string, path: string, createParents = false): string {
  checkedRoot(root)
  const parts = pathParts(path)
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    if (!existsSync(current)) {
      // existsSync follows symlinks, so explicitly reject dangling symlinks too.
      try { lstatSync(current); throw new Error(`Symlink or invalid parent: ${current}`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (!createParents) continue
      mkdirSync(current, { mode: 0o700 })
    }
    const info = lstatSync(current)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Symlink or non-directory parent: ${current}`)
  }
  return join(root, ...parts)
}
function readRegular(path: string): { bytes: Buffer; file: SelfChangeFile } | undefined {
  let descriptor: number
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  try {
    const info = fstatSync(descriptor)
    if (!info.isFile()) throw new Error(`Only regular files can be checkpointed: ${path}`)
    const bytes = readFileSync(descriptor)
    return { bytes, file: { sha256: hash(bytes), size: bytes.length, mode: info.mode & 0o777 } }
  } finally { closeSync(descriptor) }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
function atomicWrite(path: string, bytes: string | Buffer, mode = 0o600): void {
  const temporary = join(dirname(path), `.spirit-${randomUUID()}.tmp`)
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode)
    try { writeFileSync(fd, bytes); chmodSync(temporary, mode); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, path); syncDirectory(dirname(path))
  }
  finally { if (existsSync(temporary)) unlinkSync(temporary) }
}
function difference(target: string, before: SelfChangeManifest, after: SelfChangeManifest): SelfChangeDifference[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(path => {
    const old = owns(before, path), current = owns(after, path)
    return same(old, current) ? [] : [{ target, path, kind: !old ? 'added' as const : !current ? 'removed' as const : 'changed' as const,
      ...(old ? { before: old } : {}), ...(current ? { after: current } : {}) }]
  })
}

/** No background updater, subprocess runner, or automatic host restart lives here. */
export class SelfChangeBook {
  readonly directory: string
  readonly targets: SelfChangeTarget[]
  readonly maxFiles: number
  readonly maxBytes: number

  constructor(options: SelfChangeOptions) {
    if (!isAbsolute(options.stateDir)) throw new Error('Self-change stateDir must be absolute')
    mkdirSync(options.stateDir, { recursive: true, mode: 0o700 })
    this.directory = join(realpathSync(options.stateDir), 'self-changes')
    mkdirSync(this.directory, { recursive: true, mode: 0o700 }); checkedRoot(this.directory)
    this.maxFiles = options.maxFiles ?? 20_000
    this.maxBytes = options.maxBytes ?? 128 * 1024 * 1024
    this.targets = options.targets.map(target => {
      targetId.parse(target.id)
      if (!isAbsolute(target.root)) throw new Error('Source roots must be absolute')
      const root = realpathSync(target.root), exclude = [...new Set(target.exclude ?? [])]
      checkedRoot(root)
      for (const path of exclude) pathParts(path)
      if (inDirectory(root, this.directory) || inDirectory(this.directory, root)) throw new Error('Self-change state must be outside every source root')
      return { ...target, root, exclude }
    })
    if (new Set(this.targets.map(target => target.id)).size !== this.targets.length) throw new Error('Duplicate source target id')
    for (const a of this.targets) for (const b of this.targets) {
      if (a !== b && (inDirectory(a.root, b.root) || inDirectory(b.root, a.root))) throw new Error('Source targets must not overlap')
    }
  }

  private directoryFor(id: string): string { return join(this.directory, z.uuid().parse(id)) }
  private event(record: SelfChangeRecord, event: string, detail: string): void {
    record.history.push({ at: stamp(), event, detail }); this.save(record)
  }
  private save(record: SelfChangeRecord): void {
    const directory = this.directoryFor(record.id); checkedRoot(directory)
    atomicWrite(join(directory, 'record.json'), JSON.stringify(record, null, 2) + '\n')
  }
  /** Cross-process exclusion. A dead process's journal remains recoverable without its runtime. */
  private lock(id: string): () => void {
    const directory = this.directoryFor(id); checkedRoot(directory)
    // One book may hold multiple candidates for the same installation.
    // Serialize them together, not merely one change id at a time.
    const path = join(this.directory, 'operation.lock')
    if (existsSync(path)) {
      const owner = JSON.parse(readRegular(path)!.bytes.toString()) as { pid: number }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid self-change lock; inspect it before removing it')
      // Reading a dead PID and then unlinking is not a compare-and-swap: another
      // process could already have acquired the same pathname. Never steal it.
      throw new Error(`Self-change operation lock already active or abandoned (recorded process ${owner.pid}). Stop participating processes, inspect and remove ${path}, then retry.`)
    }
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, id, at: stamp() })); fsyncSync(fd) } finally { closeSync(fd) }
    return () => { unlinkSync(path); syncDirectory(this.directory) }
  }
  private ignored(path: string, exclude: string[]): boolean {
    return path.split('/').some(part => part === '.git' || part === 'node_modules') || exclude.some(item => path === item || path.startsWith(item + '/'))
  }
  private scan(root: string, exclude: string[]): SelfChangeManifest {
    checkedRoot(root)
    const manifest: SelfChangeManifest = Object.create(null)
    let count = 0, size = 0
    const visit = (directory: string, prefix: string) => {
      for (const name of readdirSync(directory).sort()) {
        const path = prefix ? `${prefix}/${name}` : name
        pathParts(path)
        if (this.ignored(path, exclude)) continue
        const absolute = filePath(root, path), info = lstatSync(absolute)
        if (info.isSymbolicLink()) throw new Error(`Symlinks are not copied or applied: ${absolute}`)
        if (info.isDirectory()) visit(absolute, path)
        else {
          if (!info.isFile()) throw new Error(`Only regular source files are supported: ${absolute}`)
          if (++count > this.maxFiles || (size += info.size) > this.maxBytes) throw new Error('Source snapshot exceeds configured file/byte limits')
          const value = readRegular(absolute)
          if (!value) throw new Error(`Source changed during scan: ${absolute}`)
          manifest[path] = value.file
        }
      }
    }
    visit(root, '')
    return manifest
  }
  private copy(root: string, destination: string, manifest: SelfChangeManifest): void {
    mkdirSync(destination, { recursive: true, mode: 0o700 }); checkedRoot(destination)
    for (const path of Object.keys(manifest)) {
      const value = readRegular(filePath(root, path))
      if (!value || !same(value.file, manifest[path])) throw new Error(`Source changed while checkpointing: ${path}`)
      atomicWrite(filePath(destination, path, true), value.bytes, value.file.mode)
    }
  }
  private snapshot(record: SelfChangeRecord, id: string): SelfChangeSnapshot {
    const target = record.targets.find(target => target.id === id)
    if (!target) throw new Error(`Unknown change target: ${id}`)
    const configured = this.targets.find(item => item.id === id)
    if (!configured || configured.root !== target.root || JSON.stringify(configured.exclude) !== JSON.stringify(target.exclude)) {
      throw new Error(`Target configuration changed; inspect the record before recovery: ${id}`)
    }
    checkedRoot(target.root)
    return target
  }
  private candidateDigests(record: SelfChangeRecord): Record<string, string> {
    return Object.fromEntries(record.targets.map(target => [target.id, digest(this.scan(target.candidateDirectory, target.exclude))]))
  }
  private checkpointValid(target: SelfChangeSnapshot): void {
    if (digest(target.baseline) !== target.baselineDigest || digest(this.scan(target.checkpointDirectory, target.exclude)) !== target.baselineDigest) {
      throw new Error(`Checkpoint was changed: ${target.id}`)
    }
  }
  private baselineCurrent(record: SelfChangeRecord): void {
    for (const stored of record.targets) {
      const target = this.snapshot(record, stored.id)
      if (digest(this.scan(target.root, target.exclude)) !== target.baselineDigest) throw new Error(`Live source changed since checkpoint; create a fresh candidate: ${target.id}`)
    }
  }

  begin(input: unknown): SelfChangeRecord {
    const parsed = SelfChangeBeginInput.parse(input)
    if (new Set(parsed.targets).size !== parsed.targets.length) throw new Error('Duplicate change target')
    if (parsed.parentId) this.read(parsed.parentId)
    const selected = parsed.targets.map(id => {
      const target = this.targets.find(target => target.id === id)
      if (!target) throw new Error(`Source target is not configured: ${id}`)
      return target
    })
    const id = randomUUID(), directory = this.directoryFor(id)
    mkdirSync(directory, { mode: 0o700 })
    const record: SelfChangeRecord = { schema: 1, id, createdAt: stamp(), recoveryScript: join(directory, 'recover.mjs'), input: parsed, targets: [], state: 'candidate',
      verifications: [], activation: [], history: [] }
    try {
      const recovery = readRegular(fileURLToPath(new URL('../scripts/spirit-recover.mjs', import.meta.url)))
      if (!recovery) throw new Error('The installed package is missing scripts/spirit-recover.mjs')
      atomicWrite(record.recoveryScript, recovery.bytes, 0o700)
      for (const target of selected) {
        const baseline = this.scan(target.root, target.exclude ?? [])
        const checkpointDirectory = join(directory, 'checkpoint', target.id), candidateDirectory = join(directory, 'candidate', target.id)
        this.copy(target.root, checkpointDirectory, baseline)
        this.copy(checkpointDirectory, candidateDirectory, baseline)
        record.targets.push({ ...target, exclude: target.exclude ?? [], checkpointDirectory, candidateDirectory, baseline, baselineDigest: digest(baseline) })
        record.activation.push({ target: target.id, required: target.activation, status: 'pending' })
      }
      this.baselineCurrent(record)
      this.event(record, 'checkpoint', 'Original source and an editable candidate were saved. No running code has changed.')
    } catch (error) {
      record.state = 'checkpoint-failed'; this.event(record, 'checkpoint-failed', String(error)); throw error
    }
    return this.read(id)
  }

  read(id: string): SelfChangeRecord {
    const directory = this.directoryFor(id); checkedRoot(directory)
    const value = readRegular(join(directory, 'record.json'))
    if (!value) throw new Error('Self-change record not found')
    const record = JSON.parse(value.bytes.toString()) as SelfChangeRecord
    if (record.schema !== 1 || record.id !== id || !Array.isArray(record.targets) || !Array.isArray(record.history)) throw new Error('Invalid self-change record')
    if (record.recoveryScript !== join(directory, 'recover.mjs')) throw new Error('Independent recovery script location was changed')
    SelfChangeBeginInput.parse(record.input)
    const ids = new Set<string>()
    for (const target of record.targets) {
      targetId.parse(target.id)
      if (ids.has(target.id)) throw new Error('Duplicate persisted target')
      ids.add(target.id)
      if (target.candidateDirectory !== join(directory, 'candidate', target.id) || target.checkpointDirectory !== join(directory, 'checkpoint', target.id)) {
        throw new Error('Candidate/checkpoint location was changed')
      }
      if (typeof target.root !== 'string' || !isAbsolute(target.root)) throw new Error('Invalid persisted source root')
      for (const path of [...Object.keys(target.baseline), ...target.exclude]) pathParts(path)
    }
    const journalPaths = new Set<string>()
    for (const entry of record.application?.files ?? []) {
      pathParts(entry.path)
      const target = record.targets.find(target => target.id === entry.target), key = `${entry.target}/${entry.path}`
      if (!target || this.ignored(entry.path, target.exclude) || journalPaths.has(key) || !same(entry.before, owns(target.baseline, entry.path))) {
        throw new Error('Application journal does not match the checkpoint')
      }
      journalPaths.add(key)
    }
    return record
  }
  list(): SelfChangeRecord[] {
    return readdirSync(this.directory).filter(id => z.uuid().safeParse(id).success && existsSync(join(this.directory, id, 'record.json')))
      .map(id => this.read(id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  compare(id: string): { id: string; differences: SelfChangeDifference[]; liveChanged: string[]; candidateDigests: Record<string, string> } {
    const record = this.read(id), differences: SelfChangeDifference[] = [], liveChanged: string[] = [], candidateDigests: Record<string, string> = {}
    for (const target of record.targets) {
      this.snapshot(record, target.id)
      this.checkpointValid(target)
      const candidate = this.scan(target.candidateDirectory, target.exclude)
      candidateDigests[target.id] = digest(candidate)
      differences.push(...difference(target.id, target.baseline, candidate))
      if (digest(this.scan(target.root, target.exclude)) !== target.baselineDigest) liveChanged.push(target.id)
    }
    return { id, differences, liveChanged, candidateDigests }
  }

  /** A supervisor may request loading this version; this is still not a runtime-loaded receipt. */
  activationDetails(id: string): SelfChangeActivationDetails {
    const record = this.read(id)
    if (record.state !== 'applied' || !record.application?.completedAt || !record.verified || !record.verifications[record.verified.attempt]?.passed) {
      throw new Error('Activation requires a completed application of a verified candidate')
    }
    return { changeId: id, targets: record.targets.map(target => {
      this.snapshot(record, target.id)
      this.checkpointValid(target)
      const current = digest(this.scan(target.root, target.exclude))
      if (current !== record.verified!.digests[target.id]) throw new Error(`Live source changed after apply; verify a fresh candidate before activation: ${target.id}`)
      return { id: target.id, root: target.root, digest: current, required: target.activation }
    }) }
  }

  async verify(id: string, inputs: unknown, run: SelfChangeRun): Promise<SelfChangeRecord> {
    const checks = z.array(SelfChangeCheckInput).min(1).max(64).parse(inputs), release = this.lock(id)
    try {
      const record = this.read(id)
      if (record.state === 'checkpoint-failed') throw new Error('Checkpoint creation failed; create a fresh candidate')
      if (record.application) throw new Error('An applied candidate cannot be re-verified; begin a new change with parentId')
      const covered = new Set(checks.map(check => check.target))
      if (record.targets.some(target => !covered.has(target.id))) throw new Error('Every selected target needs at least one real verification command')
      const commands = checks.map(check => {
        const target = this.snapshot(record, check.target)
        const cwd = check.cwd && check.cwd !== '.' ? filePath(target.candidateDirectory, `${check.cwd}/.spirit-cwd`).slice(0, -'/.spirit-cwd'.length) : target.candidateDirectory
        checkedRoot(cwd)
        return { id, target: target.id, command: check.command, cwd }
      })
      this.baselineCurrent(record)
      record.targets.forEach(target => this.checkpointValid(target))
      const attempt: SelfChangeVerification = { startedAt: stamp(), passed: false, before: this.candidateDigests(record), checks: [] }
      record.verifications.push(attempt); delete record.verified; record.state = 'verifying'
      this.event(record, 'verification-started', `Running ${commands.length} commands through the caller's native permission boundary.`)
      try {
        for (const command of commands) {
          let result: SelfChangeCommandResult
          try { result = await run(command) }
          catch (error) { attempt.checks.push({ ...command, exitCode: null, error: String(error) }); throw error }
          const outputLimit = 64 * 1024
          if (result.exitCode !== null && !Number.isInteger(result.exitCode)) throw new Error('Verification runner did not return a numeric exit code')
          attempt.checks.push({ ...command, exitCode: result.exitCode,
            stdout: (result.stdout ?? '').slice(0, outputLimit), stderr: (result.stderr ?? '').slice(0, outputLimit),
            ...((result.stdout?.length ?? 0) > outputLimit || (result.stderr?.length ?? 0) > outputLimit ? { outputTruncated: true } : {}) })
          this.save(record)
          if (result.exitCode !== 0) throw new Error(`Verification command failed (${result.exitCode}): ${command.command}`)
        }
        // Builds may generate artifacts; the final tree, including those artifacts, is the applied version.
        this.baselineCurrent(record)
        record.targets.forEach(target => this.checkpointValid(target))
        attempt.after = this.candidateDigests(record); attempt.passed = true
        record.verified = { attempt: record.verifications.length - 1, digests: attempt.after }; record.state = 'verified'
      } catch (error) {
        attempt.error = String(error); record.state = 'verification-failed'
      }
      attempt.finishedAt = stamp()
      this.event(record, attempt.passed ? 'verification-passed' : 'verification-failed', attempt.error ?? 'Commands exited successfully; runtime activation and behavioral sufficiency are not implied.')
      return this.read(id)
    } finally { release() }
  }

  private mutation(record: SelfChangeRecord, operation: SelfChangeMutation['operation'], changes: SelfChangeDifference[]): SelfChangeMutation {
    return { id: record.id, operation, targets: record.targets.map(target => ({ id: target.id, root: target.root,
      paths: changes.filter(change => change.target === target.id).map(change => change.path) })) }
  }
  private liveFile(target: SelfChangeSnapshot, path: string): SelfChangeFile | undefined {
    return readRegular(filePath(target.root, path))?.file
  }
  private writeVersion(target: SelfChangeSnapshot, path: string, expected: SelfChangeFile | undefined, wanted: SelfChangeFile | undefined, source: string): void {
    const destination = filePath(target.root, path, Boolean(wanted))
    if (!same(readRegular(destination)?.file, expected)) throw new Error(`File changed during operation: ${target.id}/${path}`)
    if (!wanted) {
      if (expected) { unlinkSync(destination); syncDirectory(dirname(destination)) }
      return
    }
    const original = readRegular(filePath(source, path))
    if (!original || !same(original.file, wanted)) throw new Error(`Stored file changed: ${target.id}/${path}`)
    // Per-file atomic replace, not a transaction across the entire plugin or host.
    atomicWrite(destination, original.bytes, wanted.mode)
  }

  async apply(id: string, authorize: SelfChangeAuthorize): Promise<SelfChangeRecord> {
    if (typeof authorize !== 'function') throw new Error('A native mutation authorization callback is required')
    const release = this.lock(id)
    try {
      const record = this.read(id)
      if (record.state !== 'verified' || !record.verified || record.application) throw new Error('Only a successfully verified, unapplied candidate can be applied')
      const check = () => {
        this.baselineCurrent(record)
        const current = this.compare(id)
        for (const target of record.targets) if (current.candidateDigests[target.id] !== record.verified!.digests[target.id]) {
          throw new Error(`Candidate changed after verification; verify it again: ${target.id}`)
        }
        return current.differences
      }
      const changes = check()
      if (!changes.length) throw new Error('Candidate has no source or build artifact changes')
      // Replacing a directory by a file (or the reverse) needs a fresh root/layout migration;
      // this journal intentionally restores files, not recursively deleted directories.
      for (const change of changes) this.liveFile(this.snapshot(record, change.target), change.path)
      await authorize(this.mutation(record, 'apply', changes))
      check() // Permissions may involve waiting. Never apply a stale tree after that wait.
      record.application = { startedAt: stamp(), files: changes.map(change => ({ ...change, state: 'pending' })) }
      record.state = 'applying'; this.event(record, 'apply-started', 'Journal saved before the first live file mutation.')
      try {
        for (const entry of record.application.files) {
          const target = this.snapshot(record, entry.target)
          this.writeVersion(target, entry.path, entry.before, entry.after, target.candidateDirectory)
          entry.state = 'written'; this.save(record)
        }
        // A concurrent external edit is not silently described as a complete applied version.
        for (const target of record.targets) if (digest(this.scan(target.root, target.exclude)) !== record.verified.digests[target.id]) {
          throw new Error(`Live source changed during apply: ${target.id}`)
        }
        record.application.completedAt = stamp(); record.state = 'applied'
        this.event(record, 'applied', 'Files applied. Plugin reload or host restart is still pending; inspect the host after activation.')
      } catch (error) {
        record.state = 'apply-failed'; this.event(record, 'apply-failed', `${String(error)}. Use rollback or the independent recovery script; partial file changes may exist.`)
      }
      return this.read(id)
    } finally { release() }
  }

  async rollback(id: string, authorize: SelfChangeAuthorize): Promise<SelfChangeRecord> {
    if (typeof authorize !== 'function') throw new Error('A native mutation authorization callback is required')
    const release = this.lock(id)
    try {
      const record = this.read(id), journal = record.application
      if (!journal) throw new Error('No application journal to roll back')
      if (record.state === 'rolled-back') return record
      const check = () => {
        record.targets.forEach(target => this.checkpointValid(target))
        const conflicts = journal.files.filter(entry => {
          const current = this.liveFile(this.snapshot(record, entry.target), entry.path)
          return !same(current, entry.before) && !same(current, entry.after)
        })
        if (conflicts.length) throw new Error(`Later edits conflict with rollback: ${conflicts.map(entry => `${entry.target}/${entry.path}`).join(', ')}`)
      }
      try { check() }
      catch (error) { record.state = 'rollback-conflict'; this.event(record, 'rollback-conflict', String(error)); throw error }
      await authorize(this.mutation(record, 'rollback', journal.files))
      try { check() }
      catch (error) { record.state = 'rollback-conflict'; this.event(record, 'rollback-conflict', String(error)); throw error }
      record.state = 'rolling-back'; this.event(record, 'rollback-started', 'Restoring only journaled files; unrelated later files are retained.')
      try {
        for (const entry of [...journal.files].reverse()) {
          const target = this.snapshot(record, entry.target), current = this.liveFile(target, entry.path)
          if (!same(current, entry.before)) this.writeVersion(target, entry.path, entry.after, entry.before, target.checkpointDirectory)
          entry.state = 'restored'; this.save(record)
        }
        journal.rolledBackAt = stamp(); record.state = 'rolled-back'
        this.event(record, 'rolled-back', 'Journaled files restored; an already loaded plugin or host may still need reloading/restarting.')
      } catch (error) {
        record.state = 'rollback-failed'; this.event(record, 'rollback-failed', `${String(error)}. Retain this journal and retry after resolving the conflict.`)
      }
      return this.read(id)
    } finally { release() }
  }
}
