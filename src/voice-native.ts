import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

export type VoiceSource =
  | { kind: 'native'; sessionId: string; seq: number; turn?: number }
  | { kind: 'say'; sessionId: string; startSeq: number; turn: number }

export interface VoiceCut { ownerMessageId?: string; reading?: VoiceSource }
type Boundary = { openTurnStartSeq: number | null; lastTurn: number }
type Turn = { startSeq: number; turn: number; owner: Set<string>; attempt?: string; stop: boolean }

/** Cancel an exact claimed main turn's native inference, without clearing its inbox or stopping tools in other work. */
export class NativeVoiceTurns {
  private readonly turns = new WeakMap<Agent, Turn>()

  constructor(private readonly main: () => Agent | undefined, private readonly boundary: (agent: Agent) => Boundary,
    private readonly canWake: (agent: Agent) => boolean = () => true) {}

  private current(agent: Agent): Turn | undefined {
    if (this.main() !== agent || agent.status !== 'running') return
    const boundary = this.boundary(agent)
    if (boundary.openTurnStartSeq === null) { this.turns.delete(agent); return }
    let turn = this.turns.get(agent)
    if (!turn || turn.startSeq !== boundary.openTurnStartSeq || turn.turn !== boundary.lastTurn) {
      turn = { startSeq: boundary.openTurnStartSeq, turn: boundary.lastTurn, owner: new Set(), stop: false }
      this.turns.set(agent, turn)
    }
    return turn
  }

  claimed(agent: Agent, message: UserMessage, number: number): void {
    if (message.source.kind !== 'user' || Object.hasOwn(message.source, 'principal')) return
    const turn = this.current(agent)
    if (turn?.turn === number) turn.owner.add(message.id)
  }

  stream(agent: Agent, frame: AssistantStreamFrame): void {
    if (frame.type === 'chunk') return
    const turn = this.current(agent)
    if (!turn) return
    if (frame.type === 'start') {
      if (frame.turn !== turn.turn) return
      turn.attempt = frame.attemptId
      if (turn.stop) this.cancel(agent, turn)
    } else if (turn.attempt === frame.attemptId) turn.attempt = undefined
  }

  cut({ ownerMessageId, reading }: VoiceCut): void {
    const agent = this.main()
    if (!agent) return
    const turn = this.current(agent)
    if (!turn || turn.stop) return
    const knownInput = ownerMessageId !== undefined && turn.owner.has(ownerMessageId)
    const knownSpeech = reading?.sessionId === agent.id && reading.turn === turn.turn
      && (reading.kind === 'say' ? reading.startSeq === turn.startSeq : reading.seq > turn.startSeq && reading.seq < agent.session.seq)
    if (!knownInput && !knownSpeech) return
    turn.stop = true
    for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
      if (message.source.kind === 'spirit-mediation' && message.source.turn === turn.turn) agent.inbox.remove(message.id)
    }
    // If the Agent is carrying out a tool when speech is detected, let it
    // finish. Stop only its next generation in this same native turn.
    if (turn.attempt !== undefined) this.cancel(agent, turn)
  }

  stopped(agent: Agent, number: number): boolean {
    const turn = this.current(agent)
    return turn?.turn === number && turn.stop
  }

  private cancel(agent: Agent, turn: Turn): void {
    if (this.current(agent) !== turn) return
    agent.cancel({ kind: 'hook', reason: '本人开口打断通话回复' }, { keepInbox: true })
    // rc.5 parks existing unclaimed inputs on cancellation. A later owner
    // message may already be queued when the interruption request arrives.
    if (!agent.inbox.nextTurn.some(message => message.source.kind === 'user' && !Object.hasOwn(message.source, 'principal'))) return
    void agent.whenIdle().then(() => {
      if (this.main() !== agent || agent.status !== 'idle' || !this.canWake(agent)) return
      if (!agent.inbox.nextTurn.some(message => message.source.kind === 'user' && !Object.hasOwn(message.source, 'principal'))) return
      const [last] = agent.inbox.splice('next-turn', -1, 1, [])
      if (last) agent.followup(last)
    }).catch(() => {})
  }
}
