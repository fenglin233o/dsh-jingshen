import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const textOf = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('')
const successfulReplies = result => result.events.filter(event => event.type === 'assistant/message' && !event.data.interrupted).map(event => event.data.message)

/** Follows the rc.5 published stream, persistent messages and the public conversation using the same native IDs. */
export async function verifyMediationRuntime({ mainId, state, request, run, inspect, turn, evidence, complete, poll, findSessionId, scriptText }) {
  const provenance = async (sessionId, messageId) => (await request(`/mediation?${new URLSearchParams({ sessionId, messageId })}`, undefined, false)).records
  const matchingReply = (result, text) => {
    const matches = successfulReplies(result).filter(message => textOf(message) === text)
    assert.equal(matches.length, 1, `Expected one native delivery of ${text}`)
    return matches[0]
  }
  const explicit = (text, disposition = 'speak') => ({ name: 'spirit_reply', args: { disposition, text, reason: '测试中的公开判断。' } })
  const seenText = async id => (await request('/trace')).published.filter(row => row.sessionId === id).map(row => row.text).join('\n')
  const assertApproved = async (id, message) => {
    const rows = await provenance(id, message.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].source, 'spirit'); assert.equal(rows[0].messageId, message.id); assert.equal(rows[0].sessionId, id)
    assert.equal(rows[0].text, textOf(message))
    return rows[0]
  }
  const approvedDelivery = async (id, text) => {
    const draft = `abandoned-${randomUUID()}`
    const result = await turn(id, { id: randomUUID(), draft, calls: [explicit(text)] })
    const message = matchingReply(result, text)
    await assertApproved(id, message)
    const published = await seenText(id)
    assert(published.includes(text)); assert(!published.includes(draft))
    return message
  }

  const main = await inspect(mainId)
  const workspace = await request('/project-workspace', {})
  assert.equal(main.preset, 'dsh-spirit')
  assert(!(await request('/workspaces')).some(record => record.sessionIds.includes(mainId)))
  // rc.5 only allows selecting a new preset before the first turn. Exercise the actual same-ID change.
  const overridden = await request('/native-create', { sessionId: mainId, cwd: main.header.cwd, agentPreset: 'standard' })
  assert.equal(overridden.sessionId, mainId)
  assert.equal((await inspect(mainId)).preset, 'standard')
  const plain = `main-natural-${randomUUID()}`
  const native = await turn(mainId, { id: randomUUID(), reply: plain })
  const natural = matchingReply(native, plain)
  await assertApproved(mainId, natural)
  const review = (await request('/trace')).trace.find(row => row.purpose === 'spirit-mediation' && row.sessionId === mainId)
  assert(review && review.model === 'fixture-one'); assert.deepEqual(review.tools, ['spirit_review_reply'])
  const inbox = await request('/chat', undefined, false)
  assert(inbox.messages.some(item => item.author === 'spirit' && item.source.messageId === natural.id && item.text === plain))
  evidence('an ordinary main-session draft reaches the same selected model for a real publish decision before the native and IM messages are delivered')

  const privateProbe = `private-${randomUUID()}`
  const body = '我选择现在告诉你。'
  const draft = `withheld-${randomUUID()}`
  const beforeReview = (await request('/trace')).trace.filter(row => row.purpose === 'spirit-mediation').length
  const decision = await turn(mainId, { id: randomUUID(), draft, privateProbe, calls: [explicit(body)] })
  const explicitMessage = matchingReply(decision, body)
  const receipt = await assertApproved(mainId, explicitMessage)
  assert(receipt.callId && receipt.reason.includes('公开判断'))
  assert.equal((await request('/trace')).trace.filter(row => row.purpose === 'spirit-mediation').length, beforeReview)
  assert(!(await seenText(mainId)).includes(draft))
  const publicMessages = (await request('/chat', undefined, false)).messages.filter(item => item.author === 'spirit')
  assert(!JSON.stringify(publicMessages).includes(privateProbe)); assert(!JSON.stringify(publicMessages).includes(draft)); assert(!JSON.stringify(receipt).includes(privateProbe))
  evidence('an explicit expression selects the actual public body in one model request and keeps the discarded draft and reasoning out of the public IM and proof')

  for (const disposition of ['wait', 'silent']) {
    const hidden = `abandoned-${disposition}-${randomUUID()}`
    await turn(mainId, { id: randomUUID(), draft: hidden, calls: [{ name: 'spirit_reply', args: { disposition, reason: '这次选择暂时不发。' } }] })
    assert(!(await seenText(mainId)).includes(hidden))
    assert(!(await request('/chat', undefined, false)).messages.some(item => item.author === 'spirit' && item.text.includes(hidden)))
  }
  const first = `段落甲-${randomUUID()}`, next = `段落乙-${randomUUID()}`
  const two = await turn(mainId, { id: randomUUID(), calls: [explicit(first, 'continue'), explicit(next)] })
  const firstReceipt = await assertApproved(mainId, matchingReply(two, first)), nextReceipt = await assertApproved(mainId, matchingReply(two, next))
  assert.equal(firstReceipt.turn, nextReceipt.turn); assert(nextReceipt.step > firstReceipt.step)
  assert(!(two.events.some(event => event.type === 'tool/call' && event.data.name === 'spirit_reply')))
  evidence('waiting and silence withhold drafts, while two volunteered utterances have distinct native message IDs and model steps in one turn')

  const standard = await request('/native-create', { sessionId: `standard-${randomUUID()}`, workspaceId: workspace.id, agentPreset: 'standard', permissionPreset: 'workspace-write' })
  const original = `ordinary-project-${randomUUID()}`
  const untouched = matchingReply(await turn(standard.sessionId, { id: randomUUID(), reply: original }), original)
  assert.deepEqual(await provenance(standard.sessionId, untouched.id), [])
  assert(!(await request('/trace')).trace.some(row => row.purpose === 'spirit-mediation' && row.sessionId === standard.sessionId))
  const project = await request('/native-create', { workspaceId: workspace.id, agentPreset: 'dsh-spirit' })
  const projectMessage = await approvedDelivery(project.sessionId, `project-${randomUUID()}`)
  assert.deepEqual(await provenance(mainId, projectMessage.id), [])
  const projectWork = { id: randomUUID(), hold: true, draft: '这段仍在项目里推敲。' }
  await turn(project.sessionId, projectWork, false)
  await poll(async () => (await request('/trace')).held.includes(projectWork.id), 'project is computing without an active tool')
  const working = (await request('/chat', undefined, false)).presence.activity
  assert.equal(working.kind, 'working'); assert.equal(working.sessionId, project.sessionId)
  await request('/release-stream', { scriptId: projectWork.id })
  await poll(async () => (await inspect(project.sessionId)).status === 'idle', 'project completes its native turn')
  evidence('a participating project shows the laptop during real model work even before any tool runs')
  evidence('a participating owner project carries an exact provenance record and a standard project retains native output without a Spirit record')

  const custom = await request('/native-create', { sessionId: `custom-${randomUUID()}`, workspaceId: workspace.id, agentPreset: 'standard' })
  const nativeKnobs = { permissionPreset: 'custom', sandbox: 'read-only', approval: 'never' }
  const permissionsOf = ({ permissionPreset, sandbox, approval }) => ({ permissionPreset, sandbox, approval })
  assert.deepEqual(permissionsOf(await request('/native-custom-permissions', { sessionId: custom.sessionId })), nativeKnobs)
  const joined = await request('/native-create', { sessionId: custom.sessionId, workspaceId: workspace.id, agentPreset: 'dsh-spirit' })
  assert.equal(joined.sessionId, custom.sessionId, 'Owner switches the preset on the same custom-permission conversation')
  assert.equal(joined.agentPreset, 'dsh-spirit')
  assert.deepEqual(permissionsOf(await inspect(custom.sessionId)), nativeKnobs)
  const customText = `approved-in-custom-project-${randomUUID()}`
  const customReply = matchingReply(await turn(custom.sessionId, { id: randomUUID(), reply: customText }), customText)
  assert.equal((await assertApproved(custom.sessionId, customReply)).method, 'review')

  await request('/permissions', { mode: 'full' }, false)
  assert.deepEqual(permissionsOf(await inspect(custom.sessionId)), nativeKnobs)
  assert.equal((await inspect(mainId)).permissionPreset, 'danger-full-access')
  const forbidden = 'Custom project must not implicitly create a full-access session'
  const denied = await run(custom.sessionId, 'spirit_sessions', { action: 'create', title: forbidden, cwd: join(state, 'custom-denied-target'),
    reason: '测试原生权限拒绝把自定会话的授权扩大到其他会话。' }, { allowError: true })
  assert(denied.result.error)
  assert((await request('/state', undefined, false)).sessions.some(item => item.id === custom.sessionId && item.nativePermissions === true))
  assert(!(await request('/state', undefined, false)).sessions.some(item => item.title === forbidden))
  assert.deepEqual(permissionsOf(await inspect(custom.sessionId)), nativeKnobs)
  await approvedDelivery(custom.sessionId, `custom-after-full-${randomUUID()}`)
  evidence('an explicitly participating custom project mediates normally and retains its native sandbox and approval even when global access becomes full')

  assert.equal((await inspect(project.sessionId)).permissionPreset, 'danger-full-access')
  assert.deepEqual(permissionsOf(await request('/native-custom-permissions', { sessionId: project.sessionId })), nativeKnobs)
  const localPanel = await request('/state', undefined, false)
  assert.equal(localPanel.permissions.status, 'applied')
  assert(localPanel.sessions.some(item => item.id === project.sessionId && item.nativePermissions === true))
  await request('/permissions', { mode: 'ask' }, false)
  assert.equal((await inspect(mainId)).permissionPreset, 'workspace-write')
  assert.deepEqual(permissionsOf(await inspect(project.sessionId)), nativeKnobs)
  await approvedDelivery(project.sessionId, `adopt-custom-after-join-${randomUUID()}`)
  await request('/permissions', { mode: 'full' }, false)
  evidence('an already participating project keeps the owner’s later native customization and other conversations remain operable')

  const created = await run(mainId, 'spirit_sessions', { action: 'create', title: '独立工作', cwd: join(state, 'work-from-spirit'),
    selection: { provider: 'spirit-fixture', model: 'fixture-one', reasoningEffort: 'low' }, reason: '验证精神参与的工作会话。' })
  const childId = findSessionId(created.result)
  assert(childId && childId !== mainId)
  await approvedDelivery(childId, `work-${randomUUID()}`)
  evidence('a session created through the actual spirit_sessions tool also withholds original fragments before delivering its attributed output')

  const delegateName = 'native-mediation-child'
  const rawChildText = `native-delegate-output-${randomUUID()}`, parentText = `mediated-delegate-parent-${randomUUID()}`
  const childScript = { id: randomUUID(), reply: rawChildText, hold: true }
  const dispatched = await turn(mainId, { id: randomUUID(), reply: parentText, calls: [{ name: 'subagent', args: {
    name: delegateName, description: 'Native delegation provenance fixture', prompt: scriptText(childScript),
  } }] })
  const parent = matchingReply(dispatched, parentText)
  assert.equal((await assertApproved(mainId, parent)).method, 'review')
  const child = await poll(async () => (await request('/trace')).lifecycle.find(row => row.event === 'subagent/start' && row.parentSessionId === mainId), 'native delegation starts')
  await poll(async () => (await request('/trace')).held.includes(childScript.id), 'native child reaches its provider stream')
  await request('/release-stream', { scriptId: childScript.id })
  await poll(async () => (await request('/trace')).lifecycle.some(row => row.event === 'subagent/end' && row.runId === child.runId), 'native delegation settles')
  const nativeChild = matchingReply({ events: await request(`/logs?${new URLSearchParams({ sessionId: child.id })}`) }, rawChildText)
  assert.deepEqual(await provenance(child.id, nativeChild.id), [])
  assert(!(await request('/trace')).trace.some(row => row.sessionId === child.id && row.purpose === 'spirit-mediation'))
  evidence('a native delegation parent is mediated and its child retains separate native authorship')

  const held = { id: randomUUID(), hold: true, draft: `never-visible-${randomUUID()}` }
  await turn(mainId, held, false)
  await poll(async () => (await request('/trace')).held.includes(held.id), 'fixture emitted its prefix and is holding the rest of the real stream')
  assert(!(await seenText(mainId)).includes(held.draft))
  await request('/control', { action: 'pause' }, false)
  await poll(async () => (await inspect(mainId)).status === 'idle', 'pause aborted the in-flight publication')
  assert(!(await seenText(mainId)).includes(held.draft))
  assert(!(await request('/chat', undefined, false)).messages.some(item => item.author === 'spirit' && item.text.includes(held.draft)))
  await request('/control', { action: 'resume' }, false)
  evidence('pausing after the adapter generated draft tokens prevents even a transient native text fragment from reaching its consumer')

  const modified = `连在原生界面切换主会话预设时也要先给精神-${randomUUID()}`
  const overrideResult = await turn(mainId, { id: randomUUID(), calls: [explicit(modified)] })
  await assertApproved(mainId, matchingReply(overrideResult, modified))
  evidence('the identified main session continues through Spirit after an explicit native preset change')

  const raw = `PROBE_REVIEW_CHANGE-${randomUUID()}`
  const replaced = await turn(mainId, { id: randomUUID(), reply: raw })
  const revised = matchingReply(replaced, '我重新看过了，这才是我准备交付的答复。')
  await assertApproved(mainId, revised)
  assert(!(await seenText(mainId)).includes(raw)); assert(!successfulReplies(replaced).some(m => textOf(m).includes(raw)))
  evidence('the fallback expression review can rewrite an ordinary model answer before the very first published text token')
  await complete(mainId, childId)
}
