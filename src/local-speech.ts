import { fork, type ChildProcess } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_WAV_BYTES } from './voice-protocol.ts'

type SpeechKind = 'tts' | 'asr'
type Synthesis = { text: string; speed?: number; voice?: string; model?: string }
type SpeechInput = { text: string; speed: number; voice?: string } | { wav: Uint8Array }
type Init = { kind: 'tts'; directory: string } | { kind: 'asr'; directory: string; addon: string }
type Job = {
  id: number
  input: SpeechInput
  init: Init
  signal: AbortSignal
  resolve(value: unknown): void
  reject(error: unknown): void
  abort(): void
}
interface LocalSpeechOptions {
  addonPath?: string
  resolutionPath?: string
  modelRoot?: string
  idleMS?: number
  workerPath?: string
}
const workerPath = fileURLToPath(new URL('../scripts/local-speech/worker.cjs', import.meta.url))
const defaultModelRoot = fileURLToPath(new URL('../media/voice/local/', import.meta.url))
const asrFiles = ['encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt', 'weights-01.data', 'weights-02.data']
const ttsScripts = ['prime.cjs', 'ort.cjs', 'pcm.cjs', 'pinyin/index.cjs', 'ort/ort.wasm.min.mjs',
  'ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm']
const maxPending = 8
const deadlines = { tts: 90_000, asr: 45_000 } as const

function isFile(path: string): boolean {
  try {
    const file = statSync(path, { throwIfNoEntry: false })
    return !!file?.isFile() && file.size > 0
  } catch { return false }
}

function installedAddon(resolutionPath?: string): { path: string; libraries: string } | undefined {
  const platform = process.platform === 'win32' ? 'win' : process.platform
  const native = `sherpa-onnx-${platform}-${process.arch}/sherpa-onnx.node`
  function from(req: NodeJS.Require) {
    const path = req.resolve('sherpa-onnx-node')
    const folder = dirname(path)
    const binary = [join(folder, 'node_modules', native), join(folder, '..', native)].find(isFile)
    return binary && { path, libraries: dirname(binary) }
  }
  const local = createRequire(import.meta.url)
  try {
    const addon = from(local)
    if (addon) return addon
  } catch { /* The rc.5 host may own the runtime. */ }
  const paths = [resolutionPath, process.argv[1]]
  for (const path of [undefined, ...paths]) {
    try {
      const req = !path ? local : createRequire(realpathSync(path))
      const host = !path ? createRequire(req.resolve('@deepseek-ai/dsh/package.json')) : req
      const bundle = createRequire(host.resolve('@deepseek-ai/dsh-experimental-voice-input-bundle/package.json'))
      const senseVoice = createRequire(bundle.resolve('@deepseek-ai/dsh-experimental-speech-to-text-sensevoice/package.json'))
      const addon = from(senseVoice)
      if (addon) return addon
    } catch { /* The optional native package is unavailable for this installation. */ }
  }
  return undefined
}

function hasPrimeModel(directory: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'model.json'), 'utf8')) as Record<string, unknown>
    if (manifest.type !== 'prime' || !Array.isArray(manifest.files) || !manifest.files.length) return false
    return manifest.files.every((file: unknown) => {
      if (typeof file !== 'string' || !file || isAbsolute(file)) return false
      const path = resolve(directory, file)
      const suffix = relative(directory, path)
      return !!suffix && suffix.split(/[\\/]/u)[0] !== '..' && !isAbsolute(suffix) && isFile(path)
    })
  } catch { return false }
}

function workerEnv(libraries: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  const key = process.platform === 'linux' ? 'LD_LIBRARY_PATH' : process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'PATH'
  if (libraries) env[key] = [libraries, env[key]].filter(Boolean).join(delimiter)
  return env
}

class SpeechWorker {
  private child?: ChildProcess
  private active?: Job
  private pending: Job[] = []
  private timer?: NodeJS.Timeout
  private requestId = 0
  private closed = false

  constructor(private readonly path: string, private readonly idleMS: number, private readonly deadline: number,
    private readonly env: NodeJS.ProcessEnv) {}

  request(init: Init, input: SpeechInput, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (this.closed || this.pending.length >= maxPending) throw new Error('本机语音任务暂不可用')
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++this.requestId, input, init, signal, resolve, reject, abort: () => this.abort(job) }
      this.pending.push(job)
      signal.addEventListener('abort', job.abort, { once: true })
      this.next()
    })
  }

  private abort(job: Job): void {
    if (this.active === job) {
      this.fail(job.signal.reason)
      return
    }
    this.pending = this.pending.filter(item => item !== job)
    job.reject(job.signal.reason)
  }

  private start(): ChildProcess {
    const child = fork(this.path, [], { env: this.env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced' })
    this.child = child
    const stopped = (error: Error) => { if (this.child === child) this.fail(error) }
    child.on('error', stopped)
    child.on('exit', () => stopped(new Error('本机语音进程已退出')))
    child.on('disconnect', () => stopped(new Error('本机语音进程已断开')))
    child.on('message', (reply: { id?: number; result?: unknown; error?: string } | null) => {
      if (this.child !== child || !this.active || this.active.id !== reply?.id) return
      const job = this.take()
      if (reply.error) job?.reject(new Error(reply.error))
      else job?.resolve(reply.result)
      this.next()
    })
    return child
  }

  private next(): void {
    if (this.closed || this.active) return
    clearTimeout(this.timer)
    const job = this.pending.shift()
    if (!job) {
      if (!this.child) return
      this.child.unref()
      this.child.channel?.unref()
      this.timer = setTimeout(() => this.stopChild(), this.idleMS)
      this.timer.unref()
      return
    }
    this.active = job
    try {
      const child = this.child ?? this.start()
      child.ref()
      child.channel?.ref()
      this.timer = setTimeout(() => this.fail(new Error('本机语音处理超时')), this.deadline)
      child.send({ id: job.id, init: job.init, input: job.input }, error => {
        if (error && this.child === child && this.active === job) this.fail(error)
      })
    } catch (error) { this.fail(error) }
  }

  private take(): Job | undefined {
    clearTimeout(this.timer)
    const job = this.active
    this.active = undefined
    if (job) job.signal.removeEventListener('abort', job.abort)
    return job
  }

  private stopChild(): void {
    const child = this.child
    this.child = undefined
    child?.kill('SIGKILL')
  }

  private fail(error: unknown): void {
    this.take()?.reject(error)
    this.stopChild()
    this.next()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const error = new DOMException('本机语音已关闭', 'AbortError')
    this.fail(error)
    for (const job of this.pending.splice(0)) {
      job.signal.removeEventListener('abort', job.abort)
      job.reject(error)
    }
  }
}

export class LocalSpeech {
  private readonly directory: string
  private readonly path: string
  private readonly addon?: { path: string; libraries?: string }
  private readonly workers: Record<SpeechKind, SpeechWorker>
  private closed = false

  constructor(options: LocalSpeechOptions = {}) {
    this.directory = resolve(options.modelRoot ?? defaultModelRoot)
    this.path = resolve(options.workerPath ?? workerPath)
    this.addon = options.addonPath ? { path: resolve(options.addonPath) } : installedAddon(options.resolutionPath)
    const idleMS = options.idleMS ?? 30_000
    this.workers = {
      tts: new SpeechWorker(this.path, idleMS, deadlines.tts, workerEnv(undefined)),
      asr: new SpeechWorker(this.path, idleMS, deadlines.asr, workerEnv(this.addon?.libraries)),
    }
  }

  private init(kind: SpeechKind): Init | undefined {
    if (this.closed || !isFile(this.path)) return undefined
    const directory = join(this.directory, kind)
    const scripts = dirname(this.path)
    if (kind === 'tts') {
      if (!ttsScripts.every(file => isFile(join(scripts, file))) || !hasPrimeModel(directory)) return undefined
      return { kind, directory }
    }
    if (!this.addon || !isFile(this.addon.path) || !isFile(join(scripts, 'recognize.cjs'))
      || !asrFiles.every(file => isFile(join(directory, file)))) return undefined
    return { kind, directory, addon: this.addon.path }
  }

  available(kind: SpeechKind): boolean { return !!this.init(kind) }

  async synthesize(message: Synthesis, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    signal.throwIfAborted()
    const init = this.init('tts')
    if (!init) throw new Error('本机语音合成不可用')
    const text = message.text.trim()
    const speed = message.speed ?? 1
    if (text.length > 256 || !Number.isFinite(speed) || speed < 0.6 || speed > 1.6) throw new Error('语音合成参数无效')
    if (!text) return new ReadableStream({ start: controller => controller.close() })
    const cancelled = new AbortController()
    return new ReadableStream<Uint8Array>({
      pull: async controller => {
        const jobSignal = AbortSignal.any([signal, cancelled.signal])
        const pcm = await this.workers.tts.request(init, { text, speed, voice: message.voice }, jobSignal)
        if (!Buffer.isBuffer(pcm) || pcm.byteLength % 2) throw new Error('本机语音合成未返回有效音频')
        jobSignal.throwIfAborted()
        if (pcm.byteLength) controller.enqueue(pcm)
        controller.close()
      },
      cancel: reason => { cancelled.abort(reason) },
    }, { highWaterMark: 0 })
  }

  async transcribe(wav: Uint8Array, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const init = this.init('asr')
    if (!init) throw new Error('本机语音识别不可用')
    if (!wav.byteLength || wav.byteLength > MAX_WAV_BYTES) throw new Error('语音识别的音频大小无效')
    const result = await this.workers.asr.request(init, { wav }, signal)
    signal.throwIfAborted()
    if (typeof result !== 'string') throw new Error('本机语音识别未返回有效文本')
    return result
  }

  close(): void {
    this.closed = true
    this.workers.tts.close()
    this.workers.asr.close()
  }
}
