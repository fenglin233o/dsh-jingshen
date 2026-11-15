import { randomUUID } from 'node:crypto'
import type { Store } from '../upstream/src/app/store.ts'

export type AccessMode = 'ask' | 'full'
export type ActivityMode = 'running' | 'paused' | 'stopped'
export interface OwnerControl {
  mode: AccessMode
  state: ActivityMode
  revision: number
  changedAt: string
  reason: string
}
export interface ManagedSession { id: string; title: string; reason: string; createdAt: string; kind: 'main' | 'task' | 'initiative' }
export interface Activity { id: string; at: string; kind: string; summary: string; reason?: string; sessionId?: string }
const stamp = () => new Date().toISOString()

/** Owner selection and provenance survive a plugin reload. These are runtime controls, not a philosophical endpoint. */
export class SpiritControl {
  constructor(readonly store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS spirit_control (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_watches (id TEXT PRIMARY KEY, reason TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_activity (id TEXT PRIMARY KEY, value TEXT NOT NULL);`)
    if (!store.db.prepare('SELECT id FROM spirit_control WHERE id=1').get()) {
      this.write({ mode: 'ask', state: 'running', revision: 1, changedAt: stamp(), reason: '首次启用：敏感操作询问本人' })
    }
  }
  current(): OwnerControl {
    return JSON.parse(String(this.store.db.prepare('SELECT value FROM spirit_control WHERE id=1').get()!.value)) as OwnerControl
  }
  private write(value: OwnerControl): void {
    this.store.db.prepare('INSERT INTO spirit_control VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(value))
  }
  /** Called by owner HTTP controls only; no model-facing setter is registered. */
  select(change: { mode?: AccessMode; state?: ActivityMode }, reason: string): OwnerControl {
    return this.store.atomic(() => {
      const value = { ...this.current(), ...change, revision: this.current().revision + 1, changedAt: stamp(), reason }
      this.write(value)
      this.record('owner-control', reason)
      return value
    })
  }
  assertActive(revision?: number): void {
    const value = this.current()
    if (value.state !== 'running') throw new Error(value.state === 'paused' ? '本人已暂停精神的活动' : '本人已停止精神的活动')
    if (revision !== undefined && value.revision !== revision) throw new Error('权限或活动状态已改变；重新判断后再执行')
  }
  manage(id: string, title: string, reason: string, kind: ManagedSession['kind']): void {
    const previous = this.sessions().find(item => item.id === id)
    const value: ManagedSession = { id, title, reason, kind, createdAt: previous?.createdAt ?? stamp() }
    this.store.db.prepare('INSERT INTO spirit_sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, JSON.stringify(value))
  }
  sessions(): ManagedSession[] {
    return this.store.db.prepare('SELECT value FROM spirit_sessions ORDER BY rowid').all().map(row => JSON.parse(String(row.value)) as ManagedSession)
  }
  managed(id: string): boolean { return !!this.store.db.prepare('SELECT id FROM spirit_sessions WHERE id=?').get(id) }
  watch(id: string, reason: string): void {
    this.store.db.prepare('INSERT INTO spirit_watches VALUES(?,?) ON CONFLICT(id) DO UPDATE SET reason=excluded.reason').run(id, reason)
    this.record('watch', '观察会话的后续变化', reason, id)
  }
  unwatch(id: string): void { this.store.db.prepare('DELETE FROM spirit_watches WHERE id=?').run(id) }
  watches(): { id: string; reason: string }[] {
    return this.store.db.prepare('SELECT id, reason FROM spirit_watches ORDER BY rowid').all().map(row => ({ id: String(row.id), reason: String(row.reason) }))
  }
  record(kind: string, summary: string, reason?: string, sessionId?: string): Activity {
    const item: Activity = { id: randomUUID(), at: stamp(), kind, summary: summary.slice(0, 16000), ...(reason ? { reason: reason.slice(0, 16000) } : {}), ...(sessionId ? { sessionId } : {}) }
    this.store.db.prepare('INSERT INTO spirit_activity VALUES(?,?)').run(item.id, JSON.stringify(item))
    return item
  }
  activity(limit = 100): Activity[] {
    return this.store.db.prepare('SELECT value FROM spirit_activity ORDER BY rowid DESC LIMIT ?').all(Math.max(1, Math.min(limit, 1000)))
      .map(row => JSON.parse(String(row.value)) as Activity)
  }
}

/** Native tools retain their own sandbox/approval policies. This classifies only Spirit-owned cross-session/source mutations. */
export function sensitiveSpiritCall(name: string, args: unknown): boolean {
  const action = args && typeof args === 'object' ? (args as { action?: unknown }).action : undefined
  if (name === 'spirit_sessions') return ['create', 'post', 'model', 'stop'].includes(String(action))
  if (name === 'spirit_change') return ['begin', 'verify', 'apply', 'rollback', 'activate'].includes(String(action))
  return false
}
