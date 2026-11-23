import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ToolDispatchExecution } from '@deepseek-ai/dsh-tools'
import type { MediationAdmission } from './mediation.ts'

const nativeCalls = new Set([
  'subagent', 'subagent_fork', 'send_message', 'interrupt_agent',
  'team_task_create', 'team_task_update',
])
const profileMutations = new Set(['set_plugin', 'set_bundle', 'install_bundle', 'remove_bundle', 'set_version_exemption'])
const isPeer = (source: UserMessage['source']): source is Extract<UserMessage['source'], { senderSessionId: SessionId }> =>
  source.kind === 'agent-message' || source.kind === 'subagent-settled'

interface Authorization {
  owns(root: Agent): boolean
  revision(): number
  assert(root: Agent, revision: number, signal?: AbortSignal): void
}
type Lease = { root: Agent; revision: number; abort: AbortController; jobOwners: Set<SessionId> }
type Run = { info: SubagentRunInfo; lease: Lease; child?: Agent; done: PromiseWithResolvers<void> }
interface ChildJobs {
  list(owner: SessionId): { id: string; owner?: SessionId; status: string }[]
  kill(id: string, owner: SessionId, reason: string): void
}

/** Policy around native activations; Harness retains child identities, routing and settlement. */
export class SpiritDelegation {
  private readonly dispatch = new AsyncLocalStorage<Lease>()
  private readonly leases = new Map<Agent, Lease>()
  private readonly runs = new Map<SessionId, Run>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly staleWake = new WeakSet<Agent>()
  private readonly messageLeases = new WeakMap<UserMessage, Lease>()
  private closing?: Promise<void>
  private closed = false

  constructor(private readonly ctx: Context, private readonly authority: Authorization,
    private readonly admitReply?: (admission: MediationAdmission) => void) {
    // Cordis tears down independent effects concurrently, and reverses the
    // disposers yielded within one effect. Keep the observers through close.
    ctx.effect(this.observe.bind(this), 'spirit.native-delegation')
  }

  private *observe() {
    const ctx = this.ctx
    yield ctx.on('subagent/start', info => this.start(info))
    yield ctx.on('subagent/end', info => this.end(info))
    yield ctx.on('agent/inbox/inserted', ({ agent, message }) => this.keepMessage(agent, message))
    yield ctx.on('agent/status', ({ agent, status }) => {
      // Harness still wakes an idle Agent after an inbox observer removes
      // its sole waking message. Stop that wake before a model can see it.
      if (status === 'running' && this.staleWake.delete(agent)
        && !agent.inbox.nextTurn.length && !agent.inbox.nextStep.length) {
        agent.cancel({ kind: 'parent' }, { keepInbox: true })
      }
    })
    yield ctx.on('agent/pre-step', async (step, next) => {
      const { agent, signal } = step
      const run = this.runs.get(agent.id)
      const delegated = this.mediates(agent)
      const authorize = () => {
        if (!run || run.child !== agent || this.runs.get(agent.id) !== run || ctx.agents.get(agent.id) !== agent) {
          throw new Error('精神委派会话已不属于当前执行')
        }
        this.assert(run.lease, signal)
      }
      if (delegated && (!run || !this.usable(run.lease))) return { kind: 'reject' }
      if (this.staleWake.delete(step.agent) && step.step === 1 && !step.messages.length) return { kind: 'reject' }
      const decision = this.admitMessages(agent, step.messages, await next())
      if (!delegated || decision.kind === 'reject') return decision
      try {
        authorize()
        if (!this.admitReply) return decision
        const startSeq = ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq
        if (startSeq === null) return { kind: 'reject' }
        this.admitReply({ sessionId: agent.id, startSeq, turn: step.turn, step: step.step, messages: decision.messages, delegated: true, authorize })
        return decision
      } catch { return { kind: 'reject' } }
    })
    yield ctx.on('tools/execute', (exec, next) => this.execute(exec, next))
    yield ctx.on('agent/disposed', ({ agent }) => {
      if (this.leases.has(agent)) this.revoke(agent)
    })
    yield () => this.close()
  }

  mediates(agent: Agent): boolean {
    if (this.runs.get(agent.id)?.child === agent) return true
    if (agent.session.header.origin !== 'subagent') return false
    try {
      const root = this.ctx.get('subagents')?.rootOf(agent)
      return !!root && root !== agent && this.authority.owns(root)
    } catch { return false }
  }

  private lease(root: Agent): Lease {
    const revision = this.authority.revision()
    const existing = this.leases.get(root)
    if (existing?.revision === revision && !existing.abort.signal.aborted) return existing
    if (existing) this.revoke(root)
    const lease = { root, revision, abort: new AbortController(), jobOwners: new Set<SessionId>() }
    this.leases.set(root, lease)
    return lease
  }

  private assert(lease: Lease, signal?: AbortSignal): void {
    lease.abort.signal.throwIfAborted()
    if (this.closed || !this.authority.owns(lease.root)) throw new Error('委派树没有当前的精神授权')
    this.authority.assert(lease.root, lease.revision, signal)
  }

  private usable(lease: Lease): boolean {
    try { this.assert(lease); return true }
    catch { return false }
  }

  private start(info: SubagentRunInfo): void {
    const host = this.ctx.get('subagents')
    if (!host) return
    const child = info.local ? this.ctx.agents.get(info.id) : undefined
    const parent = this.ctx.agents.get(info.parentSessionId)
    const dispatch = this.dispatch.getStore()
    let root: Agent | undefined
    const member = child ?? parent
    try { if (member) root = host.rootOf(member) }
    catch { if (!dispatch) return }
    root ??= dispatch?.root
    if (!root || (!this.authority.owns(root) && dispatch?.root !== root)) return
    const lease = dispatch?.root === root ? dispatch : this.lease(root)
    const run = { info, lease, child, done: Promise.withResolvers<void>() }
    this.runs.set(info.id, run)
    if (!this.usable(lease)) { this.cancel(run); return }
    if (child) {
      lease.jobOwners.add(child.id)
      try {
        const expected = this.ctx.get('sandboxPolicy')?.overrideOf(root.session)
        const actual = this.ctx.get('sandboxPolicy')?.overrideOf(child.session)
        // A continuable child keeps historical controls. Clamp old full
        // access after revocation, and retain a narrower child sandbox.
        if (expected && (!actual || actual === 'danger-full-access' && expected !== actual || expected === 'read-only' && actual !== expected)) {
          child.session.append('sandbox/mode', { mode: expected, source: 'delegation' })
        }
        if (this.ctx.get('approval')?.overrideOf(child.session) !== 'never') {
          child.session.append('approval/policy', { policy: 'never', source: 'delegation' })
        }
      } catch (error) {
        lease.abort.abort(error)
        this.cancel(run)
        this.ctx.logger.warn(`精神无法确认委派会话 ${info.id} 的权限：${String(error)}`)
      }
    }
  }

  private end(info: SubagentRunInfo): void {
    const run = this.runs.get(info.id)
    if (run?.info.runId !== info.runId) return
    this.refreshJobs(run.lease, info.id)
    this.runs.delete(info.id)
    run.done.resolve()
  }

  private async execute<T>(exec: ToolDispatchExecution, next: () => Promise<T>): Promise<T> {
    const agent = exec.agent
    if (!agent) return next()
    const candidate = this.runs.get(agent.id)
    const run = candidate?.child === agent ? candidate : undefined
    if (!run && (!nativeCalls.has(exec.name) || !this.authority.owns(agent))) return next()
    const lease = run?.lease ?? this.lease(agent)
    this.assert(lease, exec.signal)
    if (run) {
      // Profile changes and recurring work outlive the delegated Session.
      // Ordinary capabilities continue through the host's own tool policies.
      const action = (exec.arguments as { action?: string })?.action
      if (exec.name.startsWith('jingshen_') || exec.name.startsWith('spirit_') || exec.name === 'schedule_create' || exec.name === 'schedule_edit'
        || exec.name === 'plugin_manager' && action !== undefined && profileMutations.has(action)) {
        throw new Error('这项操作需要由委派者处理')
      }
      const sandbox = this.ctx.get('sandboxPolicy')
      const rootMode = sandbox?.overrideOf(lease.root.session)
      const childMode = sandbox?.overrideOf(agent.session)
      if (this.ctx.get('approval')?.overrideOf(agent.session) !== 'never'
        || rootMode === 'workspace-write' && childMode === 'danger-full-access'
        || rootMode === 'read-only' && childMode !== 'read-only') throw new Error('委派会话的宿主权限已改变')
    }
    // A native send to a still-resident cancelled child would otherwise
    // succeed at the inbox boundary and lose the new message to the old epoch.
    const signal = exec.signal
    const control = AbortSignal.any([signal, lease.abort.signal])
    exec.signal = control
    const operation = this.dispatch.run(lease, async () => {
      if (exec.name === 'send_message'
        && [...this.runs.values()].some(item => item.lease.root === lease.root && !this.usable(item.lease))) {
        const target = (exec.arguments as { agent?: unknown })?.agent
        const resolved = typeof target === 'string' ? await this.ctx.get('subagents')?.resolveName(agent, target, control) : undefined
        const receiver = resolved ? this.runs.get(resolved) : undefined
        if (receiver?.lease.root === lease.root && !this.usable(receiver.lease)) {
          throw new Error('先前的委派仍在停止；可以在它结束后明确续接')
        }
      }
      return next()
    })
    this.pending.add(operation)
    return operation.finally(() => {
      exec.signal = signal
      this.pending.delete(operation)
      if (run && !this.usable(lease)) this.refreshJobs(lease, agent.id)
    })
  }

  private suppress(agent: Agent, message: UserMessage): boolean {
    const admittedUnder = this.messageLeases.get(message)
    if (admittedUnder) return !this.usable(admittedUnder)
    if (!isPeer(message.source)) return false
    const sender = this.runs.get(message.source.senderSessionId)
    if (!sender) return false
    const recipient = this.runs.get(agent.id)
    return (sender.lease.root === agent || recipient?.lease.root === sender.lease.root) && !this.usable(sender.lease)
  }

  private keepMessage(agent: Agent, message: UserMessage): void {
    const run = this.runs.get(agent.id)
    if (isPeer(message.source)) {
      const sender = this.runs.get(message.source.senderSessionId)
      if (sender && (sender.lease.root === agent || run?.lease.root === sender.lease.root)) {
        this.messageLeases.set(message, sender.lease)
      }
    }
    if ((run?.child === agent && !this.usable(run.lease)) || this.suppress(agent, message)) {
      if (agent.status === 'idle') this.staleWake.add(agent)
      agent.inbox.remove(message.id)
    }
  }

  private admitMessages(agent: Agent, proposed: UserMessage[], decision: PreStepDecision): PreStepDecision {
    if (decision.kind === 'reject' || !proposed.some(message => this.suppress(agent, message))) return decision
    if (proposed.every(message => this.suppress(agent, message))) return { kind: 'reject' }
    return { ...decision, messages: decision.messages.filter(message => !this.suppress(agent, message)) }
  }

  private cancel(run: Run): void {
    try {
      if (run.child) run.child.cancel({ kind: 'parent' }, { keepInbox: false })
      else this.ctx.get('subagents')?.interrupt(run.info.id, { kind: 'ancestor', agent: run.lease.root })
    } catch (error) { this.ctx.logger.warn(`精神无法停止委派 ${run.info.id}：${String(error)}`) }
  }

  private refreshJobs(lease: Lease, owner: SessionId, revoking = false): void {
    try {
      const jobs = this.ctx.get('jobs') as ChildJobs | undefined
      const active = jobs?.list(owner).filter(job => job.owner === owner && job.status === 'running')
      if (!jobs || !active?.length) { lease.jobOwners.delete(owner); return }
      if (revoking || lease.abort.signal.aborted || this.closed) {
        for (const job of active) {
          try { jobs.kill(job.id, owner, '精神委派的权限或活动状态已改变') }
          catch (error) { this.ctx.logger.warn(`精神无法停止委派后台工作 ${job.id}：${String(error)}`) }
        }
      }
    } catch (error) { this.ctx.logger.warn(`精神无法停止委派会话 ${owner} 的后台工作：${String(error)}`) }
  }

  revoke(root?: Agent): void {
    const roots = root ? [root] : [...this.leases.keys()]
    for (const selected of roots) {
      const lease = this.leases.get(selected)
      this.leases.delete(selected)
      // The native child may dispose immediately on either abort below. Record our own stop request first.
      if (lease) for (const owner of lease.jobOwners) this.refreshJobs(lease, owner, true)
      lease?.abort.abort(new Error('精神委派的权限或活动状态已改变'))
      for (const run of this.runs.values()) if (run.lease === lease) this.cancel(run)
      if (this.ctx.agents.get(selected.id) === selected) {
        try {
          for (const message of [...selected.inbox.nextTurn, ...selected.inbox.nextStep]) {
            if (isPeer(message.source)) selected.inbox.remove(message.id)
          }
        } catch (error) { this.ctx.logger.warn(`精神无法清除会话 ${selected.id} 的委派回执：${String(error)}`) }
      }
    }
  }

  close(): Promise<void> {
    return this.closing ??= this.stop()
  }

  private async stop(): Promise<void> {
    this.closed = true
    this.revoke()
    // Native settlement inserts its notice synchronously before the end edge.
    // Retain inbox admission through outstanding startup and settlement.
    await Promise.allSettled(this.pending)
    await Promise.allSettled([...this.runs.values()].map(run => run.done.promise))
  }
}
