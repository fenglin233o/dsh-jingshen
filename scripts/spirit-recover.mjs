#!/usr/bin/env node
/**
 * Independent recovery: no plugin imports, dependency installation, or shell execution.
 * Stop Harness before rollback, then:
 *   node /path/to/spirit-recover.mjs /absolute/stateDir CHANGE_UUID
 *   node /path/to/spirit-recover.mjs /absolute/stateDir CHANGE_UUID --rollback
 * Copy this script outside the source tree before an invasive update if desired.
 * The state directory is trusted owner data, not a cryptographic audit boundary.
 * Never force away a later-edit conflict: save/merge that edit first, then retry.
 * An operation.lock is never stolen automatically. After a process crash, stop
 * Harness and its supervisor, inspect stateDir/self-changes/operation.lock, and
 * remove it only after confirming that no operation can still be running.
 */
import { createHash, randomUUID } from 'node:crypto'
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, isAbsolute, join, sep } from 'node:path'

const [state, id, action, ...extra] = process.argv.slice(2)
const stamp = () => new Date().toISOString()
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => a?.sha256 === b?.sha256 && a?.size === b?.size && a?.mode === b?.mode
const owns = (manifest, path) => Object.hasOwn(manifest, path) ? manifest[path] : undefined
const digest = manifest => hash(JSON.stringify(Object.keys(manifest).sort()
  .map(path => [path, manifest[path].sha256, manifest[path].size, manifest[path].mode])))
const inside = (root, path) => path === root || path.startsWith(root + sep)
function parts(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe relative path: ${path}`)
  return path.split('/')
}
function root(path) {
  if (!isAbsolute(path) || realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new Error(`Root moved or is not a real directory: ${path}`)
}
function filePath(directory, path, create = false) {
  root(directory)
  const names = parts(path)
  let current = directory
  for (const name of names.slice(0, -1)) {
    current = join(current, name)
    if (!existsSync(current)) {
      try { lstatSync(current); throw new Error(`Symlink or invalid parent: ${current}`) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (!create) continue
      mkdirSync(current, { mode: 0o700 })
    }
    if (!lstatSync(current).isDirectory()) throw new Error(`Symlink or non-directory parent: ${current}`)
  }
  return join(directory, ...names)
}
function read(path) {
  let fd
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  try {
    const info = fstatSync(fd)
    if (!info.isFile()) throw new Error(`Only regular files are recoverable: ${path}`)
    const bytes = readFileSync(fd)
    return { bytes, file: { sha256: hash(bytes), size: bytes.length, mode: info.mode & 0o777 } }
  } finally { closeSync(fd) }
}
function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
function write(path, bytes, mode = 0o600) {
  const temp = join(dirname(path), `.spirit-${randomUUID()}.tmp`)
  try {
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode)
    try { writeFileSync(fd, bytes); chmodSync(temp, mode); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temp, path); syncDirectory(dirname(path))
  }
  finally { if (existsSync(temp)) unlinkSync(temp) }
}
function ignored(path, exclude) {
  return path.split('/').some(part => part === '.git' || part === 'node_modules') || exclude.some(item => path === item || path.startsWith(item + '/'))
}
function scan(directory, exclude) {
  root(directory)
  const manifest = Object.create(null)
  const visit = (absolute, prefix) => {
    for (const name of readdirSync(absolute).sort()) {
      const path = prefix ? `${prefix}/${name}` : name
      parts(path)
      if (ignored(path, exclude)) continue
      const location = filePath(directory, path), info = lstatSync(location)
      if (info.isDirectory()) visit(location, path)
      else {
        if (!info.isFile()) throw new Error(`Checkpoint contains a symlink or special file: ${path}`)
        const value = read(location)
        if (!value) throw new Error(`Checkpoint changed during recovery: ${path}`)
        manifest[path] = value.file
      }
    }
  }
  visit(directory, '')
  return manifest
}
function validFile(file) {
  return file === undefined || file && /^[0-9a-f]{64}$/.test(file.sha256) && Number.isSafeInteger(file.size) && file.size >= 0 && Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777
}
let release
try {
  if (!state || !isAbsolute(state) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '') || action && action !== '--rollback' || extra.length) {
    throw new Error('Usage: node spirit-recover.mjs /absolute/stateDir CHANGE_UUID [--rollback]')
  }
  const directory = join(realpathSync(state), 'self-changes', id)
  root(directory)
  const recordPath = join(directory, 'record.json')
  const recordBytes = read(recordPath)?.bytes
  const record = JSON.parse(recordBytes?.toString() ?? 'null')
  if (!record || record.schema !== 1 || record.id !== id || !Array.isArray(record.targets) || !Array.isArray(record.history)) throw new Error('Invalid recovery record')
  const targets = new Map()
  for (const target of record.targets) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(target.id) || targets.has(target.id)) throw new Error('Invalid or duplicate recovery target')
    root(target.root)
    if (inside(target.root, directory) || inside(directory, target.root)) throw new Error('Recovery state and source roots must be separate')
    if (target.checkpointDirectory !== join(directory, 'checkpoint', target.id)) throw new Error('Checkpoint location was changed')
    if (!Array.isArray(target.exclude) || !target.baseline || typeof target.baseline !== 'object') throw new Error('Invalid checkpoint manifest')
    for (const path of target.exclude) parts(path)
    for (const [path, file] of Object.entries(target.baseline)) {
      parts(path)
      if (!validFile(file) || ignored(path, target.exclude)) throw new Error(`Invalid checkpoint entry: ${path}`)
    }
    if (digest(target.baseline) !== target.baselineDigest || digest(scan(target.checkpointDirectory, target.exclude)) !== target.baselineDigest) throw new Error(`Checkpoint was changed: ${target.id}`)
    targets.set(target.id, target)
  }
  const files = record.application?.files ?? []
  if (!Array.isArray(files)) throw new Error('Invalid application journal')
  const seen = new Set()
  const inspect = () => files.map(entry => {
    const target = targets.get(entry.target), key = `${entry.target}/${entry.path}`
    parts(entry.path)
    if (!target || seen.has(key) || ignored(entry.path, target.exclude) || !validFile(entry.before) || !validFile(entry.after) || !same(entry.before, owns(target.baseline, entry.path))) throw new Error(`Journal does not match checkpoint: ${key}`)
    seen.add(key)
    const current = read(filePath(target.root, entry.path))?.file
    return { target: entry.target, path: entry.path, status: same(current, entry.before) ? 'original' : same(current, entry.after) ? 'applied' : 'conflict' }
  })
  let status = inspect()
  const summary = () => ({ id, state: record.state, targets: record.targets.map(({ id, root, activation }) => ({ id, root, activation })), files: status,
    note: 'Recovery restores journaled files only. Loaded plugin/host code may still need a reload/restart.' })
  if (!action) process.stdout.write(JSON.stringify(summary(), null, 2) + '\n')
  else {
    if (!record.application) throw new Error('No application journal to roll back')
    const lockPath = join(dirname(directory), 'operation.lock')
    if (existsSync(lockPath)) {
      const owner = JSON.parse(read(lockPath).bytes.toString())
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid operation lock; inspect before removing it')
      throw new Error(`Operation lock exists (recorded process ${owner.pid}). Stop Harness and its supervisor, inspect and remove ${lockPath}, then retry recovery.`)
    }
    const fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, id, at: stamp() })); fsyncSync(fd) } finally { closeSync(fd) }
    release = () => { unlinkSync(lockPath); syncDirectory(dirname(directory)) }
    if (!recordBytes?.equals(read(recordPath)?.bytes)) throw new Error('Recovery record changed while waiting for its lock; run recovery again')
    const save = (event, detail) => {
      if (event) record.history.push({ at: stamp(), event, detail })
      write(recordPath, JSON.stringify(record, null, 2) + '\n')
    }
    seen.clear(); status = inspect()
    if (status.some(entry => entry.status === 'conflict')) {
      record.state = 'rollback-conflict'; save('rollback-conflict', 'Independent recovery refused to overwrite later edits.')
      process.stdout.write(JSON.stringify(summary(), null, 2) + '\n')
      throw new Error('Later edits conflict with recovery; preserve/merge those edits before retrying')
    }
    if (record.state !== 'rolled-back') {
      record.state = 'rolling-back'; save('rollback-started', 'Independent recovery started; no plugin code was loaded.')
      try {
        for (const entry of [...files].reverse()) {
          const target = targets.get(entry.target), destination = filePath(target.root, entry.path, Boolean(entry.before))
          const current = read(destination)?.file
          if (!same(current, entry.before)) {
            if (!same(current, entry.after)) throw new Error(`Later edit during recovery: ${entry.target}/${entry.path}`)
            if (entry.before) {
              const baseline = read(filePath(target.checkpointDirectory, entry.path))
              if (!baseline || !same(baseline.file, entry.before)) throw new Error(`Checkpoint changed during recovery: ${entry.path}`)
              write(destination, baseline.bytes, entry.before.mode)
            } else { unlinkSync(destination); syncDirectory(dirname(destination)) }
          }
          entry.state = 'restored'; save()
        }
        record.application.rolledBackAt = stamp(); record.state = 'rolled-back'
        save('rolled-back', 'Independent recovery restored journaled files. Runtime activation remains a separate operation.')
      } catch (error) { record.state = 'rollback-failed'; save('rollback-failed', String(error)); throw error }
    }
    seen.clear(); status = inspect()
    process.stdout.write(JSON.stringify(summary(), null, 2) + '\n')
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally { release?.() }
