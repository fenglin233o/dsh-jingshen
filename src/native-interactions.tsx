import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './native-interactions.css?raw'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { personalSpiritInteractions: unknown }
}

/* The official approval and question plugins own these live carriers and their Remote answers. */
interface Interaction { readonly sessionId: SessionId; readonly kind: string; readonly key: string }
interface Approval extends Interaction {
  readonly kind: 'approval'
  readonly toolName: string
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
  readonly answerable: boolean
  answer(outcome: 'allowed-once' | 'rejected'): Promise<void>
}
interface QuestionItem {
  readonly id: string; readonly question: string; readonly detail?: string; readonly header?: string; readonly multiSelect?: boolean
  readonly options?: readonly { readonly label: string; readonly description?: string }[]
}
interface Question extends Interaction {
  readonly kind: 'question' | 'plan-review'
  readonly questions: readonly QuestionItem[]
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => { readonly closed: boolean; readonly channel: 'waterfall' | 'rpc' | 'none' }
  engage(): void
  holdFocus(): void
  releaseFocus(): void
  answer(answer: { answers: { id: string; selected: string[]; custom?: string }[] }): Promise<void>
}
interface NativeSessionUi {
  readonly sessionStatus: {
    subscribe(listener: () => void): () => void
    getSnapshot(): ReadonlyMap<SessionId, { readonly pendingInteraction?: Interaction }>
  }
}
export interface NativeInteractionsProps {
  ctx: Context; sessionId: SessionId; onPendingChange?(pending: number): void
}

function isApproval(value: Interaction | undefined): value is Approval {
  return value?.kind === 'approval' && typeof (value as Approval).answer === 'function'
}
function isQuestion(value: Interaction | undefined): value is Question {
  return (value?.kind === 'question' || value?.kind === 'plan-review') && typeof (value as Question).answer === 'function'
}
const emptyUnsubscribe = () => () => {}
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

function useNativeAnswer() {
  const active = useRef(false)
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  return { pending, error, run: async (action: () => Promise<void>): Promise<void> => {
    if (active.current) return
    active.current = true; setPending(true); setError('')
    try { await action() }
    catch (reason) { setError(errorText(reason)); active.current = false; setPending(false) }
  } }
}

function NativeApproval({ approval }: { approval: Approval }) {
  const { pending, error, run } = useNativeAnswer()
  const reason = approval.displayReason?.['zh-CN'] ?? approval.displayReason?.zh ?? approval.reason ?? approval.displayReason?.en
  return <section className="jingshen-native-interaction" data-native-interaction="approval" aria-label="敏感操作审批">
    <strong>敏感操作审批</strong><code>{approval.toolName}</code>
    {reason && <p>{reason}</p>}
    <div className="jingshen-native-actions">
      <button type="button" disabled={pending || !approval.answerable} onClick={() => void run(async () => {
        if (approval.answerable) await approval.answer('rejected')
      })}>拒绝</button>
      <button type="button" disabled={pending || !approval.answerable} onClick={() => void run(async () => {
        if (approval.answerable) await approval.answer('allowed-once')
      })}>允许一次</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>
}

function NativeQuestion({ card }: { card: Question }) {
  const state = useSyncExternalStore(card.subscribe, card.getSnapshot, card.getSnapshot)
  const { pending, error, run } = useNativeAnswer()
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [text, setText] = useState<Record<string, string>>({})
  const answers = card.questions.map(({ id }) => ({ id, selected: selections[id] ?? [], ...(text[id]?.trim() ? { custom: text[id]!.trim() } : {}) }))
  const enabled = !state.closed && state.channel !== 'none' && !pending && answers.every(item => item.selected.length || item.custom)
  const answer = (event: FormEvent) => {
    event.preventDefault()
    if (enabled) void run(() => card.answer({ answers }))
  }
  return <form className="jingshen-native-interaction" data-native-interaction="question" aria-label="精神正在询问" onSubmit={answer}
    onFocus={() => card.holdFocus()} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) card.releaseFocus() }}>
    <strong>{card.kind === 'plan-review' ? '请核对方案' : '精神正在询问'}</strong>
    {card.questions.map(item => <fieldset key={item.id} disabled={pending || state.closed}>
      <legend>{item.header ? `${item.header} · ` : ''}{item.question}</legend>
      {item.detail && <p>{item.detail}</p>}
      {item.options?.map(option => <label key={option.label}>
        <input type={item.multiSelect ? 'checkbox' : 'radio'} name={item.id} checked={selections[item.id]?.includes(option.label) ?? false}
          onChange={event => {
            card.engage()
            const checked = event.target.checked
            setSelections(previous => ({ ...previous, [item.id]: item.multiSelect
              ? checked ? [...previous[item.id] ?? [], option.label] : (previous[item.id] ?? []).filter(label => label !== option.label)
              : [option.label] }))
            if (!item.multiSelect) setText(previous => ({ ...previous, [item.id]: '' }))
          }} />
        {option.label}{option.description && <small>{option.description}</small>}
      </label>)}
      <label>{item.options?.length ? '其他回答' : '回答'}<input type="text" maxLength={8000} value={text[item.id] ?? ''}
        onChange={event => {
          card.engage()
          setText(previous => ({ ...previous, [item.id]: event.target.value }))
          if (!item.multiSelect) setSelections(previous => ({ ...previous, [item.id]: [] }))
        }} /></label>
    </fieldset>)}
    <div className="jingshen-native-actions"><button type="submit" disabled={!enabled}>发送回答</button></div>
    {error && <p role="alert">{error}</p>}
  </form>
}

export function NativeInteractions({ ctx, sessionId, onPendingChange }: NativeInteractionsProps) {
  const root = ctx as Context & { readonly sessions: ISessions; readonly uiSession?: NativeSessionUi }
  const status = root.uiSession?.sessionStatus
  const subscribe = useCallback((listener: () => void) => status?.subscribe(listener) ?? emptyUnsubscribe(), [status])
  const read = useCallback(() => status?.getSnapshot().get(sessionId)?.pendingInteraction, [status, sessionId])
  const value = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    if (!status) return
    const controller = new AbortController()
    let reference: ReturnType<ISessions['retain']> | undefined
    let retaining = false
    const retain = () => {
      if (controller.signal.aborted || retaining || reference || !root.sessions.list.getSnapshot().byId[sessionId]) return
      retaining = true
      try {
        const current = root.sessions.retain(sessionId, { signal: controller.signal, source: 'personalSpiritInteractions' })
        reference = current
        void current.ready.catch(() => { current.release(); if (reference === current) reference = undefined })
      } catch { /* The native catalog can change while the Web client is reconnecting. */ }
      finally { retaining = false }
    }
    const unsubscribe = root.sessions.list.subscribe(retain)
    retain()
    if (!reference) void root.sessions.refresh().then(retain).catch(() => {})
    return () => { controller.abort(); unsubscribe(); reference?.release() }
  }, [root, status, sessionId])
  const approval = value?.sessionId === sessionId && isApproval(value) ? value : undefined
  const question = value?.sessionId === sessionId && isQuestion(value) ? value : undefined
  const count = approval || question ? 1 : 0
  useEffect(() => { onPendingChange?.(count) }, [count, onPendingChange])
  useEffect(() => () => onPendingChange?.(0), [onPendingChange])
  if (approval) return <><style>{css}</style><NativeApproval key={approval.key} approval={approval} /></>
  if (question) return <><style>{css}</style><NativeQuestion key={question.key} card={question} /></>
  return null
}
