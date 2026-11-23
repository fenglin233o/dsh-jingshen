/** Test the voice cut against the exact rc.5 native generation and inbox. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function verifyVoiceRuntime({ origin, mainId, request, inspect, turn, scriptText, evidence, complete, poll }) {
  const chat = () => request('/chat', undefined, false)
  const trace = () => request('/trace')
  const call = await request('/voice/call', {}, false)
  const path = (endpoint, extra = {}) => `/voice/${endpoint}?${new URLSearchParams({ call: call.id, ...extra })}`
  const stream = await fetch(`${origin}/personal-spirit/api${path('events')}`, {
    headers: { 'x-personal-spirit': '1' }, signal: AbortSignal.timeout(45_000),
  })
  assert.equal(stream.status, 200)
  const reader = stream.body.getReader()
  const decode = new TextDecoder()
  let pending = ''
  const event = async type => {
    for (;;) {
      const boundary = pending.indexOf('\n')
      if (boundary !== -1) {
        const value = JSON.parse(pending.slice(0, boundary))
        pending = pending.slice(boundary + 1)
        if (value.type === type) return value
        continue
      }
      const next = await reader.read()
      assert(!next.done, `Voice stream ended before ${type}`)
      pending += decode.decode(next.value, { stream: true })
    }
  }
  try {
    await event('ready')
    const workspace = await request('/project-workspace', {})
    const project = await request('/native-create', { workspaceId: workspace.id, agentPreset: 'dsh-jingshen' })
    const heldProject = { id: randomUUID(), hold: true, reply: '项目未中断。' }
    await turn(project.sessionId, heldProject, false)
    await poll(async () => (await trace()).held.includes(heldProject.id), 'parallel project native generation is active')

    const text = '这段已经送达，可以开口打断。'
    const withheld = `voice-undelivered-${randomUUID()}`
    const earlier = { id: randomUUID(), hold: true, reply: withheld, calls: [
      { name: 'jingshen_reply', args: { disposition: 'continue', text, reason: '先交付第一段，再继续这次主会话推理。' } },
    ] }
    const accepted = await request('/chat', { requestId: randomUUID(), text: scriptText(earlier) }, false)
    const delivered = (await event('speech')).message
    const publicMessage = (await chat()).messages.find(item => item.id === delivered.id)
    assert.equal(delivered.text, text)
    assert.equal(publicMessage?.source.sessionId, mainId)
    assert.equal(publicMessage?.source.kind, 'native')
    assert.equal(publicMessage?.author, 'spirit')
    await poll(async () => (await trace()).held.includes(earlier.id), 'main native continuation entered the held provider')

    // The client acknowledges the selected output as playing. This checks
    // production media presence. The browser smoke covers scheduling sound.
    await request(path('playing', { message: delivered.id, state: 'start' }), {}, false)
    assert.equal((await chat()).presence.activity.kind, 'phone')
    await request(path('interrupt', { through: '0', reading: 'not-delivered' }), {}, false)
    assert((await trace()).held.includes(earlier.id), 'an unknown playback does not cancel native inference')

    const newer = { id: randomUUID(), hold: true, reply: '这条是用户随后提交的新问题。' }
    const later = await request('/chat', { requestId: randomUUID(), text: scriptText(newer) }, false)
    assert((await inspect(mainId)).inbox.nextTurn > 0)
    const cut = () => request(path('interrupt', { through: String(delivered.sequence), reading: delivered.id }), {}, false)
    await cut()
    await poll(async () => {
      const active = (await trace()).held
      return !active.includes(earlier.id) && active.includes(newer.id)
    }, 'the matching old inference aborts and queued new owner input continues')
    const interrupted = await inspect(mainId)
    const cancelled = interrupted.events.find(item => item.type === 'turn/end' && item.data.turn === publicMessage.source.turn)
    assert.equal(cancelled?.data.reason.kind, 'aborted')
    assert.match(cancelled.data.reason.reason.reason, /打断/u)
    assert.equal(interrupted.events.filter(item => item.type === 'user/message' && item.data.id === accepted.messageId).length, 1)
    assert.equal(interrupted.events.filter(item => item.type === 'user/message' && item.data.id === later.messageId).length, 1)
    assert.notEqual((await chat()).presence.activity.kind, 'phone')
    assert(!(await chat()).messages.some(item => item.text === withheld))
    assert.equal((await inspect(project.sessionId)).status, 'running')
    assert((await trace()).held.includes(heldProject.id))

    await cut()
    assert((await trace()).held.includes(newer.id), 'a late cut for the old delivery does not cancel a newer turn')
    assert.equal((await request('/release-stream', { scriptId: newer.id })).released, true)
    assert.equal((await request('/release-stream', { scriptId: heldProject.id })).released, true)
    await poll(async () => (await chat()).messages.some(message => message.text === newer.reply), 'the next owner receives its normal mediated reply')
    evidence('voice interruption stops the exact native main continuation, releases phone presence, and preserves later owner input and project work', {
      nativeTurn: publicMessage.source.turn, interruptedMessageId: publicMessage.source.messageId, preservedInput: later.messageId, project: project.sessionId,
    })
    await complete(mainId, project.sessionId)
  } finally {
    await request(path('hangup'), {}, false).catch(() => {})
    await reader.cancel().catch(() => {})
  }
}
