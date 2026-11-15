/** Explicit supervised activation. File application and loading a running version remain separate facts. */
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { activationPaths, assertAppliedChange, listReceipts, liveSupervisor, readJSON, readSupervisor, recordPath,
  stamp, UUID, writeJSON } from '../scripts/activation-protocol.mjs'

export interface ActivationTarget { id: string; root: string; digest: string; required: 'plugin-reload' | 'host-restart' }
export interface ActivationDetails { changeId: string; targets: ActivationTarget[] }
export type ActivationStatus = 'requested' | 'restart-required' | 'restarting' | 'booting' | 'runtime-loaded' | 'failed' | 'cancelled'
export interface ActivationReceipt extends ActivationDetails {
  schema: 1; id: string; reason: string; requestedAt: string; updatedAt: string; status: ActivationStatus
  supervisorId?: string; bootId?: string; restartedAt?: string; loadedAt?: string; error?: string
  runtime?: { pid: number; version?: string; runtimeHash?: string }
  history: { at: string; status: ActivationStatus; detail: string }[]
}
export interface ActivationPaths {
  stateDir: string; directory: string; receipts: string; cancellations: string; acknowledgements: string; supervisor: string; lock: string
}
export interface SupervisorState {
  schema: 1; instanceId: string; pid: number; state: 'starting' | 'running' | 'restarting' | 'failed' | 'stopped'
  startedAt: string; updatedAt: string; bootId?: string; requestId?: string; childPid?: number; detail?: string
}
export interface BootAcknowledgement {
  schema: 1; supervisorId: string; bootId: string; at: string; requestId?: string
  runtime: { pid: number; version?: string; runtimeHash?: string }
}
export class ActivationService {
  readonly paths: ActivationPaths
  private readonly env: NodeJS.ProcessEnv
  constructor(options: { stateDir: string; env?: NodeJS.ProcessEnv }) {
    this.paths = activationPaths(options.stateDir)
    this.env = options.env ?? process.env
  }
  private ownSupervisor(): string | undefined {
    const id = this.env.SPIRIT_SUPERVISOR_ID
    if (!id || !UUID.test(id) || !this.env.SPIRIT_STATE_DIR) return undefined
    return realpathSync(this.env.SPIRIT_STATE_DIR) === this.paths.stateDir ? id : undefined
  }
  /** The caller gates this mutation through owner control and Harness permissions before invoking it. */
  request(input: ActivationDetails, reason = '明确请求加载已验证并应用的版本'): ActivationReceipt {
    if (!reason.trim() || reason.length > 8000) throw new Error('Activation needs a bounded reason')
    const details = assertAppliedChange(this.paths, input)
    // An exact retry belongs to the existing launch even while the supervisor is awaiting its boot acknowledgement.
    const supervisor = liveSupervisor(this.paths, this.ownSupervisor(), Date.now(), ['running', 'restarting'])
    const previous = this.list().findLast(item => item.changeId === details.changeId && item.supervisorId === supervisor?.instanceId
      && ['requested', 'restarting', 'booting', 'runtime-loaded'].includes(item.status)
      && JSON.stringify(item.targets) === JSON.stringify(details.targets))
    if (supervisor && previous) return previous
    const accepting = supervisor?.state === 'running' ? supervisor : undefined
    const status = accepting ? 'requested' : 'restart-required'
    const detail = accepting ? 'Explicit activation queued for the current supervisor.'
      : supervisor ? 'The supervisor is completing another restart. Inspect its result and make a new explicit request when it is ready; this record will not auto-run.'
      : 'No live supervisor for this process. Start under scripts/run.mjs and explicitly request activation again; this record will not auto-run.'
    const now = stamp(), receipt: ActivationReceipt = { ...details, schema: 1, id: randomUUID(), reason,
      requestedAt: now, updatedAt: now, status, ...(accepting ? { supervisorId: accepting.instanceId } : {}),
      history: [{ at: now, status, detail }] }
    writeJSON(recordPath(this.paths.receipts, receipt.id), receipt, true)
    return receipt
  }
  /** Call only after the plugin, main session, tools and HTTP handlers have completed startup. */
  ackBoot(metadata: { version?: string; runtimeHash?: string } = {}): BootAcknowledgement | undefined {
    const supervisorId = this.ownSupervisor(), bootId = this.env.SPIRIT_BOOT_ID
    if (!supervisorId || !bootId || !UUID.test(bootId)) return undefined
    const supervisor = readSupervisor(this.paths), lock = readJSON<{ instanceId: string }>(this.paths.lock, true)
    if (supervisor?.instanceId !== supervisorId || lock?.instanceId !== supervisorId || supervisor.bootId !== bootId
      || !['starting', 'restarting'].includes(supervisor.state)) return undefined
    const requestId = this.env.SPIRIT_ACTIVATION_REQUEST || undefined
    if (requestId !== supervisor.requestId) throw new Error('Boot acknowledgement does not match the supervised launch')
    if (requestId) {
      const receipt = this.read(requestId)
      if (receipt.supervisorId !== supervisorId || receipt.bootId !== bootId || receipt.status !== 'booting') throw new Error('Activation receipt is not awaiting this boot')
      assertAppliedChange(this.paths, receipt)
    }
    for (const value of Object.values(metadata)) if (value !== undefined && (!value.trim() || value.length > 500)) throw new Error('Invalid runtime metadata')
    const acknowledgement: BootAcknowledgement = { schema: 1, supervisorId, bootId, at: stamp(), ...(requestId ? { requestId } : {}),
      runtime: { pid: process.pid, ...metadata } }
    const path = recordPath(this.paths.acknowledgements, bootId), existing = readJSON<BootAcknowledgement>(path, true)
    if (existing) {
      if (existing.supervisorId !== supervisorId || existing.requestId !== requestId) throw new Error('Conflicting boot acknowledgement')
      return existing
    }
    writeJSON(path, acknowledgement, true)
    return acknowledgement
  }
  /** Queued work can be cancelled; a restart already in progress preserves the Harness process and its persisted owner mode. */
  cancelPending(reason: string): string[] {
    if (!reason.trim() || reason.length > 8000) throw new Error('Cancellation needs a bounded reason')
    const cancelled: string[] = []
    for (const receipt of listReceipts(this.paths)) if (receipt.status === 'requested') {
      const path = recordPath(this.paths.cancellations, receipt.id)
      if (!readJSON(path, true)) writeJSON(path, { id: receipt.id, at: stamp(), reason }, true)
      cancelled.push(receipt.id)
    }
    return cancelled
  }
  read(id: string): ActivationReceipt {
    const receipt = readJSON<ActivationReceipt>(recordPath(this.paths.receipts, id))
    if (!receipt || receipt.id !== id || receipt.schema !== 1) throw new Error('Activation receipt not found or invalid')
    const cancellation = receipt.status === 'requested' && readJSON<{ reason: string }>(recordPath(this.paths.cancellations, id), true)
    return cancellation ? { ...receipt, status: 'cancelled', error: cancellation.reason } : receipt
  }
  list(): ActivationReceipt[] { return listReceipts(this.paths).map(item => this.read(item.id)) }
  snapshot() { return { supervisor: readSupervisor(this.paths), receipts: this.list() } }
}
