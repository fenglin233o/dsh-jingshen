import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Submit and answer through the real rc.5 Web client and scoped Remote approval broker. */
export async function verifyNativeInteractionsRuntime({ browserUrl, mainId, state, scratch, request, inspect, scriptText, evidence, complete, poll }) {
  const require = createRequire(import.meta.url)
  const { chromium } = require('playwright')
  const phoneCheck = process.env.SPIRIT_APPROVAL_UI_PHONE === '1'
  const browser = await chromium.launch({ executablePath: process.env.SPIRIT_CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true,
    ...(phoneCheck ? { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } : {}) })
  const pageErrors = []
  const receivedEvents = new Set()
  const clientModules = []
  let page
  try {
    page = await browser.newPage({ viewport: { width: 1410, height: 1000 }, locale: 'zh-CN', ...(phoneCheck ? { permissions: ['microphone'] } : {}) })
    page.on('pageerror', error => pageErrors.push(String(error)))
    page.on('console', item => { if (item.type() === 'error' && item.text().includes('slot entry crashed')) pageErrors.push(item.text()) })
    page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      const frame = typeof payload === 'string' ? payload : payload.toString('utf8')
      for (const event of ['approval/request', 'user-questions/request']) if (frame.includes(event)) receivedEvents.add(event)
    }))
    page.on('response', response => {
      if (decodeURIComponent(response.url()).includes('dsh-jingshen')) {
        void response.text().then(body => clientModules.push({ path: new URL(response.url()).pathname, interaction: body.includes('personalSpiritInteractions') })).catch(() => {})
      }
    })
    await page.goto(browserUrl)
    const launcher = page.getByRole('button', { name: /打开精神通讯/ }), close = page.getByRole('button', { name: '缩小窗口' })
    await launcher.waitFor({ timeout: 40_000 })
    const notice = page.getByRole('dialog', { name: '预览版说明' })
    await notice.getByRole('button', { name: '继续' }).click({ timeout: 30_000 })
    const fish = page.locator('.jingshen-window')
    const input = fish.getByRole('textbox', { name: '给精神发消息' })
    await fish.locator('.jingshen-native-interactions').waitFor({ state: 'attached', timeout: 25_000 })
    await poll(async () => {
      if (await input.isVisible()) return true
      if (await launcher.isVisible()) await launcher.click({ timeout: 1000 }).catch(() => {})
      return false
    }, 'open the fish after the verified browser bundle connects')
    const submit = async (calls, inPhone = false) => {
      const id = randomUUID()
      const text = scriptText({ id, calls })
      if (inPhone) assert((await request('/chat', { requestId: randomUUID(), text }, false)).accepted)
      else {
        await input.fill(text, { timeout: 30_000 })
        await fish.getByRole('button', { name: '发送消息' }).click()
      }
      return `spirit-fixture:${id}:0`
    }
    const approval = fish.getByRole('region', { name: '敏感操作审批' })
    const sensitive = async (label, inPhone = false) => {
      const cwd = join(state, label)
      const callId = await submit([{ name: 'spirit_sessions', args: {
        action: 'create', title: label, cwd, reason: '真实原生审批集成测试。',
      } }], inPhone)
      await approval.getByRole('button', { name: '允许一次' }).waitFor({ timeout: 30_000 })
      assert.equal(await approval.getByText('spirit_sessions', { exact: true }).count(), 1)
      assert(!existsSync(cwd), 'The native mutation is still waiting for authorization')
      assert.equal((await request('/trace')).pending.length, 0, 'The fixture must not own these approvals')
      return { cwd, callId }
    }
    const nativeOutcome = async (callId, expected) => {
      const decided = await poll(async () => {
        const { events } = await inspect(mainId)
        const asked = events.find(event => event.type === 'approval/asked' && event.data.callId === callId)
        return asked && events.find(event => event.type === 'approval/decided' && event.data.id === asked.data.id)
      }, `native decision for ${callId}`)
      assert.equal(decided.data.outcome, expected)
      await poll(async () => (await inspect(mainId)).status === 'idle', 'native turn settles')
    }

    const refused = await sensitive('native-ui-refused'), captured = join(scratch, 'approval-card.png')
    await page.screenshot({ path: captured })
    await fish.getByRole('button', { name: '选择主会话模型' }).click()
    await fish.getByRole('button', { name: '返回通讯查看待处理请求' }).click()
    await approval.getByRole('button', { name: '允许一次' }).waitFor()
    await close.click()
    await page.getByRole('button', { name: /1 项需要处理/ }).click()
    await approval.getByRole('button', { name: '拒绝', exact: true }).click()
    await nativeOutcome(refused.callId, 'rejected')
    assert(!existsSync(refused.cwd))
    evidence('the native ask survives model selection and closing the fish window, and the actual Reject button prevents the mutation', { screenshot: captured })

    const approved = await sensitive('native-ui-allowed')
    await approval.getByRole('button', { name: '允许一次', exact: true }).click()
    await nativeOutcome(approved.callId, 'allowed-once')
    assert(existsSync(approved.cwd))
    assert((await request('/workspaces')).some(item => item.path === approved.cwd && item.sessionIds.length === 1))
    evidence('Allow once settles the official native approval waterfall and creates exactly one real Workspace Session')

    const pending = await sensitive('native-ui-paused')
    await request('/control', { action: 'pause' }, false)
    await approval.waitFor({ state: 'hidden', timeout: 25_000 })
    await nativeOutcome(pending.callId, 'cancelled')
    assert(!existsSync(pending.cwd))
    await request('/control', { action: 'resume' }, false)
    assert.equal(await approval.count(), 0)
    evidence('pausing withdraws the pending approval and its native cancelled outcome leaves the Workspace untouched')

    const questionId = await submit([{ name: 'ask_user_question', args: { questions: [{ id: 'format', header: '验收问题',
      question: '你选哪种交付？', options: [{ label: '本机文件', description: '保持在本机。' }, { label: '直接回复', description: '展示在此处。' }],
    }] } }])
    const question = fish.getByRole('form', { name: '精神正在询问' })
    await question.getByText('你选哪种交付？', { exact: false }).waitFor({ timeout: 30_000 })
    await question.getByRole('radio', { name: /本机文件/ }).check()
    await question.getByRole('button', { name: '发送回答' }).click()
    const result = await poll(async () => (await inspect(mainId)).events.find(event =>
      event.type === 'tool/result' && event.data.message.toolCallId === questionId), 'native question tool receives the browser answer')
    const content = result.data.message.content.filter(part => part.type === 'text').map(part => part.text).join('')
    assert(!result.data.message.isError)
    assert.deepEqual(JSON.parse(content), { answers: [{ id: 'format', selected: ['本机文件'] }] })
    evidence('the official native question carrier receives the exact option selected in the fish conversation')
    if (phoneCheck) {
      await poll(async () => (await inspect(mainId)).status === 'idle', 'native question turn finishes')
      const phone = page.getByRole('button', { name: '接通并开麦' })
      await phone.click({ timeout: 30_000 })
      const hangUp = page.getByRole('button', { name: '挂断' })
      await hangUp.waitFor({ timeout: 30_000 })
      const duringCall = await sensitive('native-ui-during-call', true)
      assert.equal(await page.locator('.jingshen-window[data-phone="true"]').count(), 1)
      const capturedCall = join(scratch, 'approval-in-call.png')
      await page.screenshot({ path: capturedCall })
      await approval.getByRole('button', { name: '拒绝', exact: true }).click()
      await nativeOutcome(duringCall.callId, 'rejected')
      assert(!existsSync(duringCall.cwd))
      await hangUp.click()
      evidence('the live phone view exposes the same official native approval and the browser refusal prevents the mutation', { screenshot: capturedCall })
    }
    assert.deepEqual(pageErrors, [])
    await complete(mainId)
  } catch (error) {
    await page?.screenshot({ path: join(scratch, 'approval-browser-failure.png') }).catch(() => {})
    const native = await request('/native-remote-events').catch(() => undefined)
    const probe = page?.locator('[data-native-probe]')
    const view = page && {
      mounted: (await page.locator('.jingshen-native-interactions').count().catch(() => 0)) > 0,
      child: (await page.locator('[data-native-interaction]').count().catch(() => 0)) > 0,
      probe: await probe?.count().catch(() => 0) ? await probe?.getAttribute('data-native-probe') : undefined,
    }
    throw new AggregateError([error, ...pageErrors], `${error.message}\nOfficial Remote events seen by browser: ${[...receivedEvents].join(', ')}\n` +
      `Gateway state: ${JSON.stringify(native)}\nInteraction view: ${JSON.stringify(view)}\nClient modules: ${JSON.stringify(clientModules)}\n${pageErrors.join('\n')}`)
  } finally { await browser.close() }
}
