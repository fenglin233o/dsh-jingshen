/** Shared, dependency-free disk protocol. No request may choose an executable or its arguments. */
import { createHash, randomUUID } from 'node:crypto'
import { constants, closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
export const stamp = () => new Date().toISOString()
export function checkedDirectory(path, create = false) {
  if (!isAbsolute(path)) throw new Error('Activation directories must be absolute')
  if (create && !existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 })
  if (realpathSync(path) !== path || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) {
    throw new Error(`Activation directory is not a real directory: ${path}`)
  }
  return path
}
export function activationPaths(stateDir) {
  if (!isAbsolute(stateDir)) throw new Error('Spirit stateDir must be absolute')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const state = realpathSync(stateDir), directory = checkedDirectory(join(state, 'activation'), true)
  const receipts = checkedDirectory(join(directory, 'receipts'), true)
  const cancellations = checkedDirectory(join(directory, 'cancellations'), true)
  const acknowledgements = checkedDirectory(join(directory, 'acknowledgements'), true)
  return { stateDir: state, directory, receipts, cancellations, acknowledgements,
    supervisor: join(directory, 'supervisor.json'), lock: join(directory, 'supervisor.lock') }
}
export function readJSON(path, optional = false) {
  checkedDirectory(dirname(path))
  let fd
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if (optional && error.code === 'ENOENT') return undefined; throw error }
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('Invalid activation record file')
    return JSON.parse(readFileSync(fd, 'utf8'))
  } finally { closeSync(fd) }
}
export function writeJSON(path, value, exclusive = false) {
  checkedDirectory(dirname(path))
  const temporary = join(dirname(path), `.activation-${randomUUID()}.tmp`)
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  try {
    if (exclusive) linkSync(temporary, path)
    else renameSync(temporary, path)
    const directory = openSync(dirname(path), constants.O_RDONLY)
    try { fsyncSync(directory) } finally { closeSync(directory) }
  } finally { if (existsSync(temporary)) unlinkSync(temporary) }
}
export function recordPath(directory, id) {
  if (!UUID.test(id)) throw new Error('Invalid activation record ID')
  checkedDirectory(directory)
  return join(directory, `${id}.json`)
}
export function listReceipts(paths) {
  checkedDirectory(paths.receipts)
  return readdirSync(paths.receipts).filter(name => name.endsWith('.json') && UUID.test(name.slice(0, -5)))
    .map(name => readJSON(join(paths.receipts, name))).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
}
export function receiptState(paths, receipt, status, detail, extra = {}) {
  const value = { ...receipt, ...extra, status, updatedAt: stamp(),
    history: [...receipt.history, { at: stamp(), status, detail }] }
  writeJSON(recordPath(paths.receipts, receipt.id), value)
  return value
}
export function readSupervisor(paths) {
  const value = readJSON(paths.supervisor, true)
  if (!value) return undefined
  if (value.schema !== 1 || !UUID.test(value.instanceId) || !Number.isSafeInteger(value.pid) || value.pid < 1
    || !['starting', 'running', 'restarting', 'failed', 'stopped'].includes(value.state)
    || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid supervisor record')
  return value
}
export function liveSupervisor(paths, instanceId, now = Date.now(), states = ['running']) {
  const value = readSupervisor(paths), lock = readJSON(paths.lock, true)
  if (!value || !instanceId || value.instanceId !== instanceId || lock?.instanceId !== instanceId
    || !states.includes(value.state) || now - Date.parse(value.updatedAt) > 6000 || now < Date.parse(value.updatedAt)) return undefined
  // A PID is diagnostic only. No persisted PID is ever signaled or used to take over a lock.
  return value
}
/** Cooperates with SelfChangeBook and its standalone recovery script; never steals a recorded lock. */
export function trySourceOperationLock(paths, changeId, supervisorId) {
  if (!UUID.test(changeId) || !UUID.test(supervisorId)) throw new Error('Invalid activation lock identity')
  const directory = checkedDirectory(join(paths.stateDir, 'self-changes')), path = join(directory, 'operation.lock'), lease = randomUUID()
  try { writeJSON(path, { pid: process.pid, id: changeId, at: stamp(), kind: 'activation', supervisorId, lease }, true) }
  catch (error) { if (error.code === 'EEXIST') return undefined; throw error }
  return () => {
    const owner = readJSON(path, true)
    if (owner?.lease !== lease || owner?.supervisorId !== supervisorId) return
    unlinkSync(path)
    const fd = openSync(directory, constants.O_RDONLY)
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }
}
function relativePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.includes('\0')
    || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid source exclusion')
  return path
}
export function validateDetails(input) {
  if (!input || !UUID.test(input.changeId) || !Array.isArray(input.targets) || !input.targets.length || input.targets.length > 8) {
    throw new Error('Invalid applied change details')
  }
  const ids = new Set()
  const targets = input.targets.map(target => {
    if (!target || !/^[a-z][a-z0-9_-]{0,63}$/.test(target.id) || ids.has(target.id)
      || !SHA256.test(target.digest) || !['plugin-reload', 'host-restart'].includes(target.required)) throw new Error('Invalid activation target')
    checkedDirectory(target.root); ids.add(target.id)
    return { id: target.id, root: target.root, digest: target.digest, required: target.required }
  })
  return { changeId: input.changeId, targets }
}
function treeDigest(root, exclude) {
  checkedDirectory(root)
  const files = [], digest = value => createHash('sha256').update(value).digest('hex')
  let bytes = 0
  const scan = (directory, prefix) => {
    checkedDirectory(directory)
    for (const name of readdirSync(directory).sort()) {
      const path = prefix ? `${prefix}/${name}` : name
      if (path.split('/').some(part => part === '.git' || part === 'node_modules')
        || exclude.some(item => path === item || path.startsWith(`${item}/`))) continue
      const absolute = join(directory, name), info = lstatSync(absolute)
      if (info.isSymbolicLink()) throw new Error('Symlinks cannot be activated as verified source')
      if (info.isDirectory()) { scan(absolute, path); continue }
      if (!info.isFile() || files.length >= 20_000 || (bytes += info.size) > 128 * 1024 * 1024) throw new Error('Activation source exceeds file or size limits')
      const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const before = fstatSync(fd), content = readFileSync(fd), after = fstatSync(fd)
        if (!before.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || content.length !== before.size) {
          throw new Error('Source changed while checking activation')
        }
        files.push([path, digest(content), content.length, after.mode & 0o777])
      } finally { closeSync(fd) }
    }
  }
  scan(root, '')
  files.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  return digest(JSON.stringify(files))
}
/** Rechecked before shutdown, before replacement spawn and after plugin startup. */
export function assertAppliedChange(paths, input) {
  const details = validateDetails(input)
  const directory = checkedDirectory(join(paths.stateDir, 'self-changes', details.changeId))
  const record = readJSON(join(directory, 'record.json'))
  if (record.id !== details.changeId || record.state !== 'applied' || !record.application?.completedAt || !record.verified
    || !record.verifications?.[record.verified.attempt]?.passed || !Array.isArray(record.targets)
    || record.targets.length !== details.targets.length) throw new Error('Activation requires a verified and fully applied change')
  for (const target of details.targets) {
    const saved = record.targets.find(item => item.id === target.id)
    if (!saved || saved.root !== target.root || saved.activation !== target.required || record.verified.digests[target.id] !== target.digest
      || !Array.isArray(saved.exclude)) throw new Error('Activation details do not match the applied change')
    const exclude = saved.exclude.map(relativePath)
    if (treeDigest(target.root, exclude) !== target.digest) throw new Error(`Applied source changed before activation: ${target.id}`)
  }
  return details
}
