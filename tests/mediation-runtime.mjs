import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const textOf = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('')
const successfulReplies = result => result.events.filter(event => event.type === 'assistant/message' && !event.data.interrupted).map(event => event.data.message)

/** Follows the rc.5 published stream, persistent messages and the public conversation using the same native IDs. */
export async function verifyMediationRuntime({ mainId, state, scratch, browserUrl, request, run, inspect, turn, evidence, complete, poll, findSessionId, scriptText }) {
  const provenance = async (sessionId, messageId) => (await request(`/mediation?${new URLSearchParams({ sessionId, messageId })}`, undefined, false)).records
  const matchingReply = (result, text) => {
    const matches = successfulReplies(result).filter(message => textOf(message) === text)
    assert.equal(matches.length, 1, `Expected one native delivery of ${text}`)
    return matches[0]
  }
  const explicit = (text, disposition = 'speak') => ({ name: 'jingshen_reply', args: { disposition, text, reason: '测试中的公开判断。' } })
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
  assert.equal(main.preset, 'dsh-jingshen')
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
  assert(review && review.model === 'fixture-one'); assert.deepEqual(review.tools, ['jingshen_review_reply'])
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
    await turn(mainId, { id: randomUUID(), draft: hidden, calls: [{ name: 'jingshen_reply', args: { disposition, reason: '这次选择暂时不发。' } }] })
    assert(!(await seenText(mainId)).includes(hidden))
    assert(!(await request('/chat', undefined, false)).messages.some(item => item.author === 'spirit' && item.text.includes(hidden)))
  }
  const first = `段落甲-${randomUUID()}`, next = `段落乙-${randomUUID()}`
  const two = await turn(mainId, { id: randomUUID(), calls: [explicit(first, 'continue'), explicit(next)] })
  const firstReceipt = await assertApproved(mainId, matchingReply(two, first)), nextReceipt = await assertApproved(mainId, matchingReply(two, next))
  assert.equal(firstReceipt.turn, nextReceipt.turn); assert(nextReceipt.step > firstReceipt.step)
  assert(!(two.events.some(event => event.type === 'tool/call' && event.data.name === 'jingshen_reply')))
  evidence('waiting and silence withhold drafts, while two volunteered utterances have distinct native message IDs and model steps in one turn')

  const whole = `PROBE_REVIEW_RECONSIDER-${randomUUID()}。\n\n这段和结论属于同一条。`, later = `后来有了另一项判断-${randomUUID()}`
  const reconsidered = await turn(mainId, { id: randomUUID(), reply: whole, followup: later })
  const wholeReceipt = await assertApproved(mainId, matchingReply(reconsidered, whole))
  const laterReceipt = await assertApproved(mainId, matchingReply(reconsidered, later))
  assert.equal(wholeReceipt.disposition, 'continue'); assert.equal(laterReceipt.disposition, 'speak')
  assert.equal(wholeReceipt.turn, laterReceipt.turn); assert(laterReceipt.step > wholeReceipt.step)
  const wholeChat = (await request('/chat', undefined, false)).messages.filter(message => [whole, later].includes(message.text))
  assert.deepEqual(wholeChat.map(message => message.text), [whole, later])
  assert(wholeChat[0].cursor < wholeChat[1].cursor)
  evidence('an intact ordinary answer is delivered before a separate native decision makes another message')

  const independentRepeat = `PROBE_REVIEW_REPEAT-${randomUUID()}`
  const repeat = await turn(mainId, { id: randomUUID(), calls: [{ name: 'jingshen_say', args: { text: independentRepeat } }], reply: independentRepeat })
  await assertApproved(mainId, matchingReply(repeat, independentRepeat))
  assert.deepEqual((await request('/chat', undefined, false)).messages.filter(message => message.text === independentRepeat).map(message => message.source.kind), ['say', 'native'])

  const acted = `交付后才决定读取材料-${randomUUID()}`
  const action = await turn(mainId, { id: randomUUID(), calls: [explicit(acted, 'continue'), { name: 'jingshen_read', args: { action: 'state' } }],
    followup: `PROBE_REVIEW_QUIET-${randomUUID()}` })
  await assertApproved(mainId, matchingReply(action, acted))
  assert(action.events.some(event => event.type === 'tool/result' && !event.data.error))
  assert(!successfulReplies(action).some(message => textOf(message).includes('PROBE_REVIEW_QUIET')))
  evidence('a new decision after delivery can execute a real native tool and then finish silently')

  const fresh = { id: randomUUID(), reply: `新输入的答复-${randomUUID()}` }
  const old = { id: randomUUID(), hold: true, reply: `PROBE_REVIEW_RECONSIDER-${randomUUID()}`, followup: `过时的续说-${randomUUID()}` }
  await turn(mainId, old, false)
  await poll(async () => (await request('/trace')).held.includes(old.id), 'main considers the first delivery while a second input queues')
  const nextTurn = turn(mainId, fresh)
  await poll(async () => (await inspect(mainId)).inbox.nextTurn > 0, 'the new owner message is in the native inbox')
  await request('/release-stream', { scriptId: old.id })
  matchingReply(await nextTurn, fresh.reply)
  const postQueued = (await request('/trace')).trace.filter(item => item.scriptId === old.id)
  assert.equal(postQueued.length, 1)
  assert(!postQueued[0].reconsidering)
  assert(!(await seenText(mainId)).includes(old.followup))
  evidence('owner input queued during publication takes the next turn before any optional continuation')

  const standard = await request('/native-create', { sessionId: `standard-${randomUUID()}`, workspaceId: workspace.id, agentPreset: 'standard', permissionPreset: 'workspace-write' })
  const original = `ordinary-project-${randomUUID()}`
  const untouched = matchingReply(await turn(standard.sessionId, { id: randomUUID(), reply: original }), original)
  assert.deepEqual(await provenance(standard.sessionId, untouched.id), [])
  assert(!(await request('/trace')).trace.some(row => row.purpose === 'spirit-mediation' && row.sessionId === standard.sessionId))
  const project = await request('/native-create', { workspaceId: workspace.id, agentPreset: 'dsh-jingshen' })
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
  const joined = await request('/native-create', { sessionId: custom.sessionId, workspaceId: workspace.id, agentPreset: 'dsh-jingshen' })
  assert.equal(joined.sessionId, custom.sessionId, 'Owner switches the preset on the same custom-permission conversation')
  assert.equal(joined.agentPreset, 'dsh-jingshen')
  assert.deepEqual(permissionsOf(await inspect(custom.sessionId)), nativeKnobs)
  const customText = `approved-in-custom-project-${randomUUID()}`
  const customReply = matchingReply(await turn(custom.sessionId, { id: randomUUID(), reply: customText }), customText)
  assert.equal((await assertApproved(custom.sessionId, customReply)).method, 'review')

  await request('/permissions', { mode: 'full' }, false)
  assert.deepEqual(permissionsOf(await inspect(custom.sessionId)), nativeKnobs)
  assert.equal((await inspect(mainId)).permissionPreset, 'danger-full-access')
  const forbidden = 'Custom project must not implicitly create a full-access session'
  const denied = await run(custom.sessionId, 'jingshen_sessions', { action: 'create', title: forbidden, cwd: join(state, 'custom-denied-target'),
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

  const created = await run(mainId, 'jingshen_sessions', { action: 'create', title: '独立工作', cwd: join(state, 'work-from-spirit'),
    selection: { provider: 'spirit-fixture', model: 'fixture-one', reasoningEffort: 'low' }, reason: '验证精神参与的工作会话。' })
  const childId = findSessionId(created.result)
  assert(childId && childId !== mainId)
  await approvedDelivery(childId, `work-${randomUUID()}`)
  evidence('a session created through the actual jingshen_sessions tool also withholds original fragments before delivering its attributed output')

  const revisedText = '我重新看过了，这才是我准备交付的答复。'
  const verifyDelegate = async (root, tool, name) => {
    const rawChildText = `PROBE_REVIEW_CHANGE-${randomUUID()}`, parentText = `mediated-delegate-parent-${randomUUID()}`
    const childScript = { id: randomUUID(), reply: rawChildText, hold: true }
    const dispatched = await turn(root, { id: randomUUID(), reply: parentText, calls: [{ name: tool, args: {
      name, description: 'Native delegation provenance fixture', prompt: scriptText(childScript),
    } }] })
    assert.equal((await assertApproved(root, matchingReply(dispatched, parentText))).method, 'review')
    await poll(async () => (await request('/trace')).held.includes(childScript.id), 'native child reaches its provider stream')
    const trace = await request('/trace')
    const childId = trace.trace.find(row => row.scriptId === childScript.id)?.sessionId
    const child = trace.lifecycle.find(row => row.event === 'subagent/start' && row.id === childId)
    assert(child && child.parentSessionId === root)
    assert(!(await seenText(child.id)).includes(rawChildText))
    await request('/release-stream', { scriptId: childScript.id })
    await poll(async () => (await request('/trace')).lifecycle.some(row => row.event === 'subagent/end' && row.runId === child.runId), 'native delegation settles')
    const nativeChild = matchingReply({ events: await request(`/logs?${new URLSearchParams({ sessionId: child.id })}`) }, revisedText)
    const childReceipt = await assertApproved(child.id, nativeChild)
    assert.equal(childReceipt.method, 'review')
    assert.equal(childReceipt.input.kind, 'delegated')
    assert.deepEqual(await provenance(root, nativeChild.id), [])
    assert(!(await seenText(child.id)).includes(rawChildText))
    assert((await seenText(child.id)).includes(revisedText))
    const settled = await poll(async () => (await inspect(root)).events.find(event => event.type === 'user/message'
      && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === child.id), 'native sender reaches the parent')
    assert(textOf(settled.data).includes(revisedText))
    assert(!textOf(settled.data).includes(rawChildText))
    return child
  }
  await verifyDelegate(mainId, 'subagent', 'native-mediation-child')
  await request('/native-team', { sessionId: mainId, enabled: true })
  await verifyDelegate(mainId, 'subagent_fork', 'native-mediation-teammate')
  evidence('spawned and forked native team members review their drafts in their own sessions and report revised text under their original sender identities')

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
  if (process.env.SPIRIT_MEDIATION_BROWSER === '1') {
    const first = `项目的第一条答复 ${randomUUID()}`, second = `项目的下一条答复 ${randomUUID()}`
    const delivered = await turn(project.sessionId, { id: randomUUID(), calls: [explicit(first, 'continue'), explicit(second)] })
    const messages = [matchingReply(delivered, first), matchingReply(delivered, second)]
    for (const message of messages) await assertApproved(project.sessionId, message)
    const screenshot = join(scratch, 'project-mediation-badges.png')
    await verifyBrowserBadges({ browserUrl, workspaceId: workspace.id, projectId: project.sessionId, messages, standardId: standard.sessionId,
      untouched, screenshot, deliveredMain: revisedText, hiddenMain: [privateProbe, draft, raw] })
    evidence('official Chromium Chat displays each verified badge, including an earlier reply after retrying a failed receipt lookup', { screenshot })
    evidence('the official Chromium private window displays the approved main reply and omits abandoned drafts and provider reasoning')
  }
  await complete(mainId, childId)
}

async function verifyBrowserBadges({ browserUrl, workspaceId, projectId, messages, standardId, untouched, screenshot, deliveredMain, hiddenMain }) {
  const { chromium } = createRequire(import.meta.url)('playwright')
  const browser = await chromium.launch({ executablePath: process.env.SPIRIT_CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    let failedReceipt = false
    await page.route('**/personal-spirit/api/mediation?*', async route => {
      if (!failedReceipt && new URL(route.request().url()).searchParams.get('messageId') === messages[0].id) {
        failedReceipt = true
        await route.fulfill({ status: 503, json: { error: '暂时无法读取测试回执' } })
      } else await route.continue()
    })
    await page.goto(browserUrl)
    await page.locator('button.jingshen-launcher').waitFor({ timeout: 40_000 })
    await page.getByRole('dialog', { name: '预览版说明' }).getByRole('button', { name: '继续' }).click({ timeout: 30_000 })
    const open = async sessionId => {
      const item = page.locator(`[data-row-key="session:${sessionId}"]`)
      if (!(await item.isVisible())) await page.locator(`[data-row-key="workspace:${workspaceId}"]`).click()
      await item.click()
      return page.locator(`[data-conversation-session="${sessionId}"]`)
    }
    const nativeResponse = (surface, message) => surface.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: textOf(message) })
    const projectSurface = await open(projectId)
    for (const message of messages) {
      const badge = nativeResponse(projectSurface, message).locator(`.jingshen-mediation-badge[data-message-id="${message.id}"]`)
      await badge.waitFor({ timeout: 20_000 })
      assert.equal(await badge.textContent(), '精神')
    }
    assert(failedReceipt, 'The earlier message badge must survive a temporary receipt error')
    await page.screenshot({ path: screenshot })

    const ordinaryLookup = page.waitForResponse(response => new URL(response.url()).searchParams.get('messageId') === untouched.id)
    const ordinary = await open(standardId)
    await nativeResponse(ordinary, untouched).waitFor()
    assert.deepEqual((await (await ordinaryLookup).json()).records, [])
    assert.equal(await ordinary.locator('.jingshen-mediation-badge').count(), 0)

    const transcript = page.getByRole('region', { name: '通讯记录' })
    if (!(await transcript.isVisible())) await page.locator('button.jingshen-launcher').click()
    const delivered = transcript.locator('[data-author="spirit"]')
    await delivered.getByText(deliveredMain, { exact: true }).waitFor()
    const publicText = (await delivered.allTextContents()).join('\n')
    assert(!hiddenMain.some(hidden => publicText.includes(hidden)))
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
}
