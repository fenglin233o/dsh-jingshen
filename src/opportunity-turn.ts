import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** The live inputs for one native turn. History, summaries and runtime snapshots
 * cannot give a settled or withdrawn background opportunity a new mandate. */
export class OpportunityTurn {
  private number = -1
  private independent = false
  private dispatches = new Set<string>()

  constructor(private readonly sessionId: string, private readonly mainId: string,
    private readonly validate: (dispatchId: string, admission?: boolean) => void) {}

  private dispatchOf({ source }: UserMessage): string | undefined {
    if (source.kind === 'spirit' && source.targetSessionId === this.sessionId && source.fromSessionId === this.mainId
      && source.requestId.startsWith('spirit-opportunity-')) return source.requestId
  }

  admit(turn: number, offered: UserMessage[], delivered = offered): UserMessage[] {
    if (this.number !== turn) {
      this.number = turn
      this.independent = false
      this.dispatches.clear()
    }
    const ignored = new Set<string>()
    const deliveredIds = new Set(delivered.map(message => message.id))
    let refusal: unknown
    for (const message of offered) {
      if (!deliveredIds.has(message.id)) continue
      const dispatch = this.dispatchOf(message)
      if (dispatch) {
        try {
          this.validate(dispatch, !this.dispatches.has(dispatch))
          this.dispatches.add(dispatch)
        } catch (error) {
          this.dispatches.delete(dispatch)
          ignored.add(message.id)
          refusal = error
        }
        continue
      }
      const { source } = message
      if (source.kind === 'user' || source.kind === 'agent-message' || source.kind === 'subagent-settled'
        || ('form' in source && source.form === 'relay')) this.independent = true
    }
    if (ignored.size && !this.independent && !this.dispatches.size) throw refusal
    this.assertCurrent()
    return ignored.size ? delivered.filter(message => !ignored.has(message.id)) : delivered
  }

  assertCurrent(): void {
    if (this.independent || this.dispatches.size === 0) return
    let failure: unknown
    for (const id of this.dispatches) {
      try { this.validate(id); return } catch (error) { failure = error }
    }
    throw failure
  }

  finish(turn: number): readonly string[] {
    if (this.number !== turn) return []
    this.number = -1
    const admitted = [...this.dispatches]
    this.dispatches.clear()
    this.independent = false
    return admitted
  }
}
