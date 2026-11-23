import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { spiritRequest } from './spirit-ui.tsx'

// The rc.5 Chat surface publishes its render keys and matching settled nodes.
// The assistant-actions slot belongs to the turn tail and misses earlier replies.
type ChatSnapshot = { nodes: {
    get(key: string): { kind: string; data?: { status?: string; finalNode?: { messageId?: MessageId } } } | undefined
} }
interface ChatBinding {
  snapshot: { subscribe(listener: () => void): () => void }
  target(name: 'chat'): { getSnapshot(): ChatSnapshot | undefined }
}
export interface NativeConversations { binding(sessionId: SessionId): ChatBinding }

type Receipt = { sessionId: string; messageId?: string; source: string; disposition: string }
type Annotation = { sessionId: SessionId; messageId: MessageId; abort: AbortController; badge?: HTMLElement; retry?: ReturnType<typeof setTimeout> }
const rowSelector = '[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])'
const surfaceSelector = '[data-conversation-session]'
const messageAt = (snapshot: ChatSnapshot | undefined, row: HTMLElement) => {
  const key = row.dataset.chatNodeKey
  const node = key ? snapshot?.nodes.get(key) : undefined
  return node?.kind === 'assistant-step' && node.data?.status === 'settled' ? node.data.finalNode?.messageId : undefined
}

export function observeMediationBadges(conversations: NativeConversations, mainId: string): () => void {
  const sessions = new Map<SessionId, { binding: ChatBinding; unsubscribe: () => void }>()
  const annotations = new Map<HTMLElement, Annotation>()
  let frame: number | undefined
  const remove = (row: HTMLElement, annotation: Annotation) => {
    annotation.abort.abort()
    clearTimeout(annotation.retry)
    annotation.badge?.remove()
    annotations.delete(row)
  }
  const attach = (row: HTMLElement, sessionId: SessionId, messageId: MessageId) => {
    const current = annotations.get(row)
    if (current?.sessionId === sessionId && current.messageId === messageId) {
      if (current.badge && current.badge.parentElement !== row) row.append(current.badge)
      return
    }
    if (current) remove(row, current)
    const annotation: Annotation = { sessionId, messageId, abort: new AbortController() }
    annotations.set(row, annotation)
    const query = new URLSearchParams({ sessionId, messageId })
    const currentRow = () => !annotation.abort.signal.aborted && row.isConnected && row.matches(rowSelector)
      && row.closest<HTMLElement>(surfaceSelector)?.dataset.conversationSession === sessionId
      && messageAt(sessions.get(sessionId)?.binding.target('chat').getSnapshot(), row) === messageId
    const lookup = async (retryDelay: number) => {
      if (!currentRow()) return
      try {
        const result = await spiritRequest<{ records: Receipt[] }>(`mediation?${query}`, undefined, annotation.abort.signal)
        if (!Array.isArray(result?.records)) throw new Error('无法读取交付回执')
        if (!currentRow() || !result.records.some(record => record?.sessionId === sessionId && record.messageId === messageId
          && record.source === 'spirit' && (record.disposition === 'speak' || record.disposition === 'continue'))) return
        const badge = document.createElement('span')
        badge.className = 'jingshen-mediation-badge'
        badge.dataset.messageId = messageId
        badge.title = '这条答复经过精神中介后交付'
        badge.textContent = '精神'
        annotation.badge = badge
        row.append(badge)
      } catch {
        if (currentRow()) annotation.retry = setTimeout(() => { void lookup(Math.min(30_000, retryDelay * 2)) }, retryDelay)
      }
    }
    void lookup(1000)
  }
  const sync = () => {
    frame = undefined
    const visibleSessions = new Set<SessionId>(), visibleRows = new Set<HTMLElement>()
    for (const surface of document.querySelectorAll<HTMLElement>(surfaceSelector)) {
      const sessionId = surface.dataset.conversationSession as SessionId | undefined
      if (!sessionId || sessionId === mainId) continue
      visibleSessions.add(sessionId)
      let session = sessions.get(sessionId)
      if (!session) {
        try {
          const binding = conversations.binding(sessionId)
          session = { binding, unsubscribe: binding.snapshot.subscribe(schedule) }
          sessions.set(sessionId, session)
        } catch { continue }
      }
      const snapshot = session.binding.target('chat').getSnapshot()
      for (const row of surface.querySelectorAll<HTMLElement>(rowSelector)) {
        if (row.closest(surfaceSelector) !== surface) continue
        const messageId = messageAt(snapshot, row)
        if (!messageId) continue
        visibleRows.add(row)
        attach(row, sessionId, messageId)
      }
    }
    for (const [row, annotation] of annotations) if (!visibleRows.has(row)) remove(row, annotation)
    for (const [id, session] of sessions) if (!visibleSessions.has(id)) { session.unsubscribe(); sessions.delete(id) }
  }
  const schedule = () => { frame ??= requestAnimationFrame(sync) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-conversation-session', 'data-chat-flow-kind', 'data-chat-node-key', 'data-chat-group-part'] })
  schedule()
  return () => {
    observer.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
    for (const session of sessions.values()) session.unsubscribe()
    for (const [row, annotation] of annotations) remove(row, annotation)
  }
}
