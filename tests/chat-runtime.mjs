/** Runs against the real Harness host via runtime-smoke.mjs --suite chat. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function verifyChatRuntime({ mainId, request, run, inspect, scriptText, evidence, complete, stop, boot, poll, sqlValues, delay }) {
  const chat = (query = '') => request(`/chat${query}`, undefined, false)
  const send = input => request('/chat', input, false)
  const state = () => request('/state', undefined, false)
  const opened = () => sqlValues('spirit_autonomy_opportunity').filter(item => item.openGrant !== undefined)
  const text = '开放机会中由模型选择发出的本地测试消息。'

  await request('/behavior', { autonomy: 'say' })
  await delay(4200)
  assert.equal((await state()).permissions.mode, 'ask')
  assert.equal((await chat()).messages.length, 0)
  assert.equal(opened().length, 0)
  evidence('Ask mode does not initiate an idle chat or native open opportunity')

  const firstSay = '第一条独立公开消息。', lastSay = '第二条独立公开消息。'
  const initialInput = { requestId: randomUUID(), text: scriptText({ id: randomUUID(), calls: [
    { name: 'jingshen_say', args: { text: firstSay, tone: 'warm' } }, { name: 'jingshen_say', args: { text: lastSay } },
  ], reply: lastSay }) }
  const receipt = await send(initialInput)
  assert.equal(receipt.accepted, true)
  await poll(async () => (await chat()).messages.some(message => message.text === lastSay), 'both explicit messages arrive first')
  const ordinary = { requestId: randomUUID(), text: scriptText({ id: randomUUID(), reply: '原生普通答复只投递一次。' }) }
  await send(ordinary)
  const publicPage = await poll(async () => {
    const page = await chat()
    return page.messages.some(message => message.text === '原生普通答复只投递一次。') && page
  }, 'public IM replies after real native turns')
  assert.equal(publicPage.mainId, mainId)
  assert.deepEqual(publicPage.messages.map(message => [message.author, message.source.kind, message.text]), [
    ['owner', 'native', initialInput.text], ['spirit', 'say', firstSay], ['spirit', 'say', lastSay],
    ['owner', 'native', ordinary.text], ['spirit', 'native', '原生普通答复只投递一次。'],
  ])
  assert.equal(publicPage.messages[1].tone, 'warm')
  const last = publicPage.messages.at(-1)
  assert.equal(last.source.sessionId, mainId)
  const native = await inspect(mainId)
  assert(native.events.some(event => event.type === 'user/message' && event.data.id === receipt.messageId
    && event.data.source.kind === 'user' && !Object.hasOwn(event.data.source, 'principal')))
  const audit = await request(`/mediation?sessionId=${encodeURIComponent(mainId)}&messageId=${encodeURIComponent(last.source.messageId)}`, undefined, false)
  assert.equal(audit.records.length, 1)
  assert.equal(audit.records[0].disposition, 'speak')
  assert.deepEqual(await send(initialInput), receipt)
  assert.deepEqual((await chat(`?after=${last.cursor}`)).messages, [])
  const head = await chat('?limit=2')
  assert.equal(head.hasMore, true)
  const prefix = await chat(`?before=${head.nextBefore}&limit=3`)
  assert.deepEqual(prefix.messages, publicPage.messages.slice(0, 3))
  evidence('IM submits authenticated owner input to the same native main session and pages exact, deduplicated replies', { ownerMessageId: receipt.messageId })

  const project = await request('/native-create', { agentPreset: 'dsh-jingshen' })
  assert(project.sessionId && project.sessionId !== mainId)
  await request('/permissions', { mode: 'full' }, false)
  const proactive = await poll(async () => (await chat(`?after=${last.cursor}`)).messages.find(message => message.text === text),
    'autonomous model calls jingshen_say on the event-free timer', 15_000)
  assert.equal(proactive.author, 'spirit')
  assert.equal(proactive.source.kind, 'say')
  assert.equal(proactive.source.sessionId, mainId)
  await request('/behavior', { autonomy: 'omit' })
  const firstOpen = await poll(() => opened().find(item => item.state === 'settled' && item.endedWithoutDecision), 'first open native turn normally concludes')
  assert.equal(firstOpen.eventCount, 0)
  assert.equal(firstOpen.revisitCount, 0)
  const secondOpen = await poll(() => opened().find(item => item.id !== firstOpen.id && item.state === 'settled' && item.endedWithoutDecision),
    'later silent open turn does not need to publish or record a decision', 15_000)
  assert.deepEqual((await chat(`?after=${last.cursor}`)).messages.map(message => message.text), [text])
  assert(!sqlValues('spirit_autonomy_decision').some(row => row.opportunityId === secondOpen.id))
  evidence('Full access allows the model to independently send a new message or quietly finish the next open turn', { published: firstOpen.id, silent: secondOpen.id })

  await request('/behavior', { autonomy: 'reconsider' })
  const autonomousMessages = await poll(async () => {
    const messages = (await chat(`?after=${proactive.cursor}`)).messages
    return messages.some(message => message.text === '再次看过以后，我另外想到一件事。') && messages
  }, 'open wake independently delivers a second native message', 15_000)
  await request('/behavior', { autonomy: 'omit' })
  assert.deepEqual(autonomousMessages.map(message => [message.source.kind, message.text]), [
    ['native', 'PROBE_REVIEW_RECONSIDER。这是一条完整的自主消息。'], ['native', '再次看过以后，我另外想到一件事。'],
  ])
  const [initialAutonomous, reconsideredAutonomous] = autonomousMessages
  assert.equal(initialAutonomous.source.turn, reconsideredAutonomous.source.turn)
  assert.notEqual(initialAutonomous.source.messageId, reconsideredAutonomous.source.messageId)
  evidence('an idle wake uses the same independent model decisions to deliver two complete messages in one native turn')

  const projectText = '项目会话决定向本人另行告知。'
  await run(mainId, 'jingshen_sessions', { action: 'post', sessionId: project.sessionId, text: scriptText({ id: randomUUID(),
    calls: [{ name: 'jingshen_say', args: { text: projectText } }], reply: '项目会话本地正文。' }), mode: 'queue', reason: '发给项目会话的实际本地测试输入' })
  const relay = await poll(async () => (await chat(`?after=${proactive.cursor}`)).messages.find(message => message.text === projectText), 'real project chooses a public message')
  assert.equal(relay.source.sessionId, project.sessionId)
  assert.equal(relay.author, 'spirit')
  const workLog = await inspect(project.sessionId)
  assert(workLog.events.some(event => event.type === 'user/message' && event.data.source.kind === 'spirit'))
  assert(!workLog.events.some(event => event.type === 'user/message' && event.data.source.kind === 'user'))
  assert(!(await chat(`?after=${relay.cursor}`)).messages.some(message => message.text === '项目会话本地正文。'))
  evidence('A project can independently publish one attributed IM message without making its private native answer an IM message', { projectId: project.sessionId })

  await request('/control', { action: 'pause' }, false)
  const paused = await chat()
  assert.equal(paused.presence.activity.kind, 'paused')
  await assert.rejects(send({ requestId: randomUUID(), text: '暂停期间不入列' }), /暂停/)
  await delay(3400)
  assert.deepEqual((await chat(`?after=${paused.cursor}`)).messages, [])
  await stop()
  const restarted = await boot()
  assert.equal(restarted.mainId, mainId)
  assert.equal((await chat()).presence.activity.kind, 'paused')
  await request('/permissions', { mode: 'ask' }, false)
  await request('/control', { action: 'resume' }, false)
  assert.deepEqual(await send(initialInput), receipt)
  assert.deepEqual((await chat(`?after=${paused.cursor}`)).messages, [])
  assert.equal((await inspect(mainId)).events.filter(event => event.type === 'user/message' && event.data.id === receipt.messageId).length, 1)
  evidence('Pause prevents delivery and restart preserves cursor and never requeues the same owner submission')
  await complete(mainId, project.sessionId)
}
