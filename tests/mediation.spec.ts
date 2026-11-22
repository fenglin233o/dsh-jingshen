import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BlockAssembler, createUserMessage, ToolCallId, type ContentBlock, type GenerateOptions, type StreamChunk, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { Store } from '../upstream/src/app/store.ts'
import { Mediation, reviewToolName } from '../src/mediation.ts'

const sessionId = 'actual-session', native = { provider: 'provider', model: 'resolved-model' }
const owner = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '本人在原生回合发言' }] })
const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(dispose => dispose()))

function fixture(authorize = vi.fn(), review = vi.fn(async function* (_options: GenerateOptions) {
  yield* block(0, tool(reviewToolName, { disposition: 'publish', reason: '复核后选择原样表达' }))
  yield finish('tool-calls')
})) {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-mediation-')), store = new Store(join(directory, 'state.sqlite'))
  const mediation = new Mediation(store, review)
  cleanup.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
  const admit = (step = 1, turn = 1, messages: readonly UserMessage[] = step === 1 ? [owner] : []) => mediation.admit({
    sessionId, startSeq: turn * 100, turn, step, messages, authorize, practice: () => ({ outlook: '从原始证据判断' }),
  })
  admit()
  return { mediation, admit, authorize, review }
}

const tool = (name: string, args: object, id = name): ContentBlock => ({ type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) })
const block = (index: number, content: ContentBlock): StreamChunk[] => [
  { type: 'block-start', index, blockType: content.type },
  ...(content.type === 'text' ? [{ type: 'text-delta' as const, index, text: content.text }] : []),
  { type: 'block-end', index, block: content },
]
const text = (value: string): ContentBlock => ({ type: 'text', text: value })
const finish = (kind: 'stop' | 'tool-calls' = 'stop'): StreamChunk => ({ type: 'finish', reason: { kind } })
async function collect(stream: AsyncIterable<StreamChunk>) {
  const result: StreamChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}
const generate = (mediation: Mediation, inputs: StreamChunk[]) => collect(mediation.stream(sessionId, native, async function* () { yield* inputs }))

function settle(mediation: Mediation, stream: StreamChunk[], { turn = 1, step = 1, interrupted = false } = {}) {
  const assembler = new BlockAssembler()
  for (const chunk of stream) assembler.push(chunk)
  const message = assembler.message(native)
  const event: SessionEvent<'assistant/message'> = { type: 'assistant/message', seq: SessionSeq(turn * 100 + step * 10), time: 1000,
    surfaceOp: 'append', data: { turn, step, message, stream: [], ...(interrupted ? { interrupted: true } : {}) } }
  mediation.observe(sessionId, event)
  return message
}

it('withholds every chunk when the provider disconnects without a terminal event', async () => {
  const { mediation } = fixture()
  const published: StreamChunk[] = []
  const consume = async () => {
    const unfinished = async function* () { yield* block(0, text('未完成的草稿')) }
    for await (const chunk of mediation.stream(sessionId, native, unfinished)) published.push(chunk)
  }
  await expect(consume()).rejects.toThrow('结束标记')
  expect(published).toEqual([])
  expect(mediation.records(sessionId)).toEqual([])
})

it('reviews complete plain text in the actual conversation before native delivery and may keep it exactly', async () => {
  const { mediation, authorize, review } = fixture()
  const terminal = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  const published: StreamChunk[] = []
  const consumed = (async () => {
    for await (const chunk of mediation.stream(sessionId, native, async function* () {
      yield* block(0, text('我会原样收到的直接回答。'))
      entered.resolve()
      await terminal.promise
      yield finish()
    })) published.push(chunk)
  })()
  await entered.promise
  expect(published).toEqual([])
  expect(mediation.records(sessionId)).toEqual([])
  terminal.resolve(); await consumed
  const message = settle(mediation, published)
  expect(authorize).toHaveBeenCalled()
  expect(review).toHaveBeenCalledTimes(1)
  expect(review).toHaveBeenCalledWith(expect.objectContaining({ ...native, sessionId, purpose: 'spirit-mediation', tools: [expect.objectContaining({ name: reviewToolName })] }))
  expect(review.mock.calls[0]?.[0].messages[0]?.content[0]).toMatchObject({ text: JSON.stringify({ input: 'owner',
    currentQuestion: '本人在原生回合发言', practice: { outlook: '从原始证据判断' }, publicDraft: '我会原样收到的直接回答。' }) })
  expect(mediation.record(sessionId, message.id)).toMatchObject({ source: 'spirit', disposition: 'speak', method: 'review', reason: '复核后选择原样表达', text: '我会原样收到的直接回答。',
    input: { kind: 'owner', messageId: owner.id }, startSeq: 100, eventSeq: 110, turn: 1, step: 1 })
  expect(mediation.record('unrelated-session', message.id)).toBeUndefined()
})

it('accepts a single fenced decision from text providers and withholds prose surrounding one', async () => {
  const decision = JSON.stringify({ disposition: 'publish', reason: '这句可以直接交付。' })
  const fence = String.fromCharCode(96).repeat(3)
  const review = vi.fn(async function* (_options: GenerateOptions) {
    const prefix = review.mock.calls.length === 1 ? '' : 'Here is another answer.\n'
    yield* block(0, text(prefix + fence + 'json\n' + decision + '\n' + fence))
    yield finish()
  })
  const { mediation, admit } = fixture(vi.fn(), review)
  const first = settle(mediation, await generate(mediation, [...block(0, text('第一条正文')), finish()]))
  expect(mediation.record(sessionId, first.id)).toMatchObject({ disposition: 'speak', text: '第一条正文' })
  admit(2)
  const second = settle(mediation, await generate(mediation, [...block(0, text('第二条正文')), finish()]), { step: 2 })
  expect(second.content).toEqual([])
  expect(mediation.approvedReply(sessionId, second.id)).toBeUndefined()
})

it('publishes only explicitly selected prose and keeps ordinary calls and native provider replay alignment', async () => {
  const { mediation, review } = fixture(), call = tool('bash', { command: 'read-public-thing' })
  const reasoning = { type: 'reasoning' as const, text: 'PRIVATE-nonpublic-provider-block' }
  const reply = tool('spirit_reply', { disposition: 'speak', text: '可见正文', tone: 'gentle', reason: '公开理由' })
  const terminal: StreamChunk = { type: 'finish', reason: { kind: 'tool-calls' }, replayState: {
    response: { kind: 'deepseek-messages', version: 1, model: native.model },
    blocks: [{ type: 'reasoning', signature: 'PRIVATE-signature' }, { type: 'text' }, { type: 'tool-call' }, { type: 'tool-call' }],
  } }
  const stream = await generate(mediation, [...block(2, reasoning), ...block(4, text('不应出现的草稿')),
    ...block(3, reply), ...block(19, call), terminal])
  const message = settle(mediation, stream)
  expect(message.content).toEqual([reasoning, call, text('可见正文')])
  expect(stream.at(-1)).toMatchObject({ reason: { kind: 'tool-calls' }, replayState: {
    blocks: [{ type: 'reasoning', signature: 'PRIVATE-signature' }, { type: 'tool-call' }, { type: 'text' }],
  } })
  expect(JSON.stringify(stream)).not.toContain('不应出现的草稿')
  expect(JSON.stringify(stream)).not.toContain('spirit_reply')
  expect(mediation.approvedReply(sessionId, message.id)).toEqual({ tone: 'gentle' })
  expect(mediation.record(sessionId, message.id)).toMatchObject({ text: '可见正文', reason: '公开理由' })
  expect(JSON.stringify(mediation.records(sessionId))).not.toContain('PRIVATE')
  expect(review).not.toHaveBeenCalled()
})

it.each(['wait', 'silent'] as const)('withholds %s and the follow-up prose after a real tool, with no fabricated message', async disposition => {
  const { mediation, admit } = fixture(), call = tool('spirit_read', { action: 'state' })
  const suppressed = await generate(mediation, [...block(0, text('被推迟的草稿')), ...block(1, call),
    ...block(2, tool('spirit_reply', { disposition, reason: '本轮等独立材料' })), finish('tool-calls')])
  const decisionMessage = settle(mediation, suppressed)
  expect(decisionMessage.content).toEqual([call])
  expect(mediation.approvedReply(sessionId, decisionMessage.id)).toBeUndefined()
  expect(mediation.records(sessionId)).toMatchObject([{ disposition, reason: '本轮等独立材料' }])
  expect(mediation.records(sessionId)[0]).not.toHaveProperty('messageId')
  expect(mediation.takeContinuation(sessionId, 1)).toBeUndefined()

  admit(2)
  const later = await generate(mediation, [...block(0, text('工具完成后的默认正文也不应出现')), finish()])
  expect(settle(mediation, later, { step: 2 }).content).toEqual([])
  expect(mediation.records(sessionId)).toHaveLength(1)
  admit(1, 2)
  const nextTurn = await generate(mediation, [...block(0, text('新一轮正常回答')), finish()])
  expect(settle(mediation, nextTurn, { turn: 2 }).content).toEqual([text('新一轮正常回答')])
})

it('continues via a separately sourced native follow-up step only after the prior part commits', async () => {
  const { mediation, admit } = fixture()
  const first = await generate(mediation, [...block(0, tool('spirit_reply', { disposition: 'continue', text: '先交付这一段' })), finish('tool-calls')])
  expect(mediation.takeContinuation(sessionId, 1)).toBeUndefined()
  const firstMessage = settle(mediation, first)
  const continuation = mediation.takeContinuation(sessionId, 1)
  expect(continuation?.source).toMatchObject({ kind: 'spirit-mediation', turn: 1 })
  expect(mediation.takeContinuation(sessionId, 1)).toBeUndefined()
  admit(2, 1, [continuation!])
  const second = await generate(mediation, [...block(0, text('后来独立交付的下一段')), finish()])
  const secondMessage = settle(mediation, second, { step: 2 })
  expect(firstMessage.id).not.toEqual(secondMessage.id)
  expect(mediation.records(sessionId).map(({ disposition, input }) => [disposition, input.kind])).toEqual([['speak', 'owner'], ['continue', 'owner']])
})

it('does not release drafts if the adapter fails or the current authorization changes', async () => {
  let allowed = true
  const { mediation } = fixture(vi.fn(() => { if (!allowed) throw new Error('permission changed') }))
  const failure: StreamChunk = { type: 'finish', reason: { kind: 'error', failure: { message: 'provider failed', code: 'TEST' } } }
  expect(await generate(mediation, [...block(0, text('adapter partial output')), failure])).toEqual([failure])
  const published: StreamChunk[] = []
  await expect((async () => {
    for await (const chunk of mediation.stream(sessionId, native, async function* () {
      yield* block(0, text('稿件完成前失去授权'))
      allowed = false
      yield finish()
    })) published.push(chunk)
  })()).rejects.toThrow('permission changed')
  expect(published).toEqual([])
  expect(mediation.records(sessionId)).toEqual([])
})

it('does not mark interrupted native output as sent or let an unrelated attempt claim a pending approval', async () => {
  const { mediation, admit } = fixture()
  const fragments = await generate(mediation, [...block(0, text('原本可交付的正文')), finish()])
  const interrupted = settle(mediation, fragments, { interrupted: true })
  expect(mediation.approvedReply(sessionId, interrupted.id)).toBeUndefined()
  expect(mediation.records(sessionId)).toMatchObject([{ interrupted: true }])
  admit(2)
  await generate(mediation, [...block(0, text('已准许的准确正文')), finish()])
  const forged = settle(mediation, [...block(0, text('不同的正文')), finish()], { step: 2 })
  expect(mediation.approvedReply(sessionId, forged.id)).toBeUndefined()
  expect(mediation.records(sessionId)).toHaveLength(1)
})

it('never sends private blocks to review, allows substantive revision, and records fail-closed or tool-only steps accurately', async () => {
  const review = vi.fn(async function* (_options: GenerateOptions) {
    if (review.mock.calls.length === 1) yield* block(0, tool(reviewToolName, { disposition: 'revise', text: '新结论保留可核查的限制', reason: '原草稿过度确定' }))
    else yield* block(0, text('unstructured reviewer output'))
    yield finish()
  })
  const { mediation, admit } = fixture(vi.fn(), review)
  const first = await generate(mediation, [...block(0, { type: 'reasoning', text: 'PRIVATE-hidden-reasoning' }), ...block(1, text('未复核的草稿')),
    ...block(2, tool('spirit_read', { query: 'PRIVATE-tool-input' })), finish('tool-calls')])
  const selected = settle(mediation, first)
  expect(selected.content).toContainEqual(text('新结论保留可核查的限制'))
  expect(selected.content).not.toContainEqual(text('未复核的草稿'))
  expect(review.mock.calls[0]?.[0].messages[0]?.content[0]).toMatchObject({ text: expect.not.stringContaining('PRIVATE') })
  expect(mediation.record(sessionId, selected.id)).toMatchObject({ method: 'review', reason: '原草稿过度确定' })
  admit(2)
  const toolOnly = await generate(mediation, [...block(0, tool('spirit_read', { action: 'state' })), finish('tool-calls')])
  settle(mediation, toolOnly, { step: 2 })
  expect(review).toHaveBeenCalledTimes(1)
  admit(3)
  const invalidReview = await generate(mediation, [...block(0, text('复核失败不可交付')), finish()])
  const notDelivered = settle(mediation, invalidReview, { step: 3 })
  expect(notDelivered.content).toEqual([])
  expect(mediation.approvedReply(sessionId, notDelivered.id)).toBeUndefined()
  expect(mediation.records(sessionId)[0]).toMatchObject({ method: 'review', disposition: 'silent' })
})
