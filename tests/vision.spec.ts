import { describe, expect, it } from 'vitest'
import { LiveVision } from '../src/vision.ts'

function fixture() {
  let now = 20_000, active = true
  const vision = new LiveVision(() => active, () => now)
  return {
    vision,
    advance(ms: number) { now += ms },
    pause() { active = false },
    frame(token: string, seq: number, rest: { capturedAt?: number; mediaTime?: number; commandId?: string } = {}) {
      return vision.frame({ token, seq, capturedAt: now, detections: [], ...rest })
    },
  }
}

describe('live vision', () => {
  it('keeps only increasing fresh observations in a bounded window without extending a stale camera lease', () => {
    const test = fixture()
    const token = test.vision.start('camera')
    expect(() => test.vision.start('screen')).toThrow()
    for (let seq = 1; seq <= 6; seq++) {
      test.advance(300)
      expect(test.frame(token, seq)).toBe(true)
    }
    expect(test.frame(token, 3)).toBe(false)
    expect(test.frame(token, 7, { capturedAt: 11_000 })).toBe(false)
    expect(test.frame(token, 7, { capturedAt: 25_000 })).toBe(false)
    expect(test.frame(token, 7, { capturedAt: 21_500 })).toBe(false)
    expect(test.vision.snapshot().recent?.map(item => item.seq)).toEqual([3, 4, 5, 6])
    test.advance(4200)
    expect(test.vision.snapshot()).toMatchObject({ active: true, watching: false })
    expect(test.vision.snapshot().reading).toBeUndefined()
    test.vision.poll(token)
    test.advance(6000)
    expect(() => test.vision.poll(token)).toThrow()
    expect(test.vision.snapshot().active).toBe(false)
  })

  it('reports watching only for real advancing playback under a selected command', () => {
    const test = fixture()
    expect(() => test.vision.watch('play')).toThrow()
    const token = test.vision.start('video')
    expect(test.frame(token, 1, { mediaTime: 2 })).toBe(false)
    expect(test.vision.watch('play')).toEqual({ requested: 'play', watching: false })
    const commandId = test.vision.poll(token).command!.id
    expect(test.frame(token, 1, { commandId, mediaTime: 0.2 })).toBe(true)
    expect(test.vision.snapshot().watching).toBe(false)
    test.advance(850)
    expect(test.frame(token, 2, { commandId, mediaTime: 0.2 })).toBe(true)
    expect(test.vision.snapshot().watching).toBe(false)
    test.advance(850)
    expect(test.frame(token, 3, { commandId, mediaTime: 1.1 })).toBe(true)
    expect(test.vision.snapshot().watching).toBe(true)
    test.vision.watch('stop')
    expect(test.vision.snapshot()).toMatchObject({ authorizedVideo: true, watching: false })
    expect(test.frame(token, 4, { commandId, mediaTime: 2.2 })).toBe(false)
    test.vision.watch('play')
    const secondCommandId = test.vision.poll(token).command!.id
    expect(secondCommandId).not.toBe(commandId)
    expect(test.frame(token, 5, { commandId, mediaTime: 2.8 })).toBe(false)
    test.vision.playbackEnded(token, commandId)
    expect(test.vision.poll(token).command?.id).toBe(secondCommandId)
    test.vision.playbackEnded(token, secondCommandId)
    expect(test.vision.poll(token).command).toBeUndefined()
  })

  it('drops visual data and video authorization as soon as the owner pauses', () => {
    const test = fixture()
    const token = test.vision.start('video')
    test.vision.watch('play')
    expect(test.vision.snapshot().authorizedVideo).toBe(true)
    test.pause()
    expect(test.vision.snapshot()).toEqual({ active: false, watching: false, authorizedVideo: false })
    expect(() => test.vision.poll(token)).toThrow()
    expect(() => test.vision.start('camera')).toThrow()
  })

  it('does not mistake a shared browser tab for an authorized player', () => {
    const test = fixture()
    const token = test.vision.start('video-tab')
    expect(test.frame(token, 1, { mediaTime: 2 })).toBe(true)
    expect(test.frame(token, 2, { mediaTime: 3 })).toBe(true)
    expect(test.vision.snapshot()).toMatchObject({ source: 'video-tab', authorizedVideo: false, watching: false })
    expect(() => test.vision.watch('play')).toThrow()
  })

  it('keeps tab observations separate from explicitly bound media playback', () => {
    const test = fixture()
    const token = test.vision.start('tab-video')
    expect(test.frame(token, 1)).toBe(true)
    expect(test.vision.snapshot()).toMatchObject({ authorizedVideo: true, watching: false })
    test.vision.watch('play')
    const commandId = test.vision.poll(token).command!.id
    expect(test.frame(token, 2)).toBe(true)
    expect(test.frame(token, 3, { mediaTime: 0.4, commandId })).toBe(true)
    expect(test.vision.snapshot().watching).toBe(false)
    test.advance(850)
    expect(test.frame(token, 4, { mediaTime: 1.3, commandId })).toBe(true)
    expect(test.vision.snapshot().watching).toBe(true)
    test.advance(4100)
    expect(test.vision.snapshot().watching).toBe(false)
  })

  it('lets a model choose and change titles only inside the explicitly granted HTTPS video domain', () => {
    const test = fixture()
    const token = test.vision.start('video-library', 'Media.Example')
    expect(() => test.vision.watch('play')).toThrow()
    for (const url of ['https://other.example/a', 'https://sub.media.example/a', 'http://media.example/a',
      'https://media.example:443/a', 'https://user@media.example/a', 'https://media.example/a#',
      'https://media.example\\@other.example/a']) {
      expect(() => test.vision.watch('play', url)).toThrow()
    }
    expect(test.vision.watch('select', 'https://media.example/first.webm')).toEqual({ requested: 'select', watching: false })
    expect(test.vision.poll(token).command?.url).toBeUndefined()
    test.vision.watch('play')
    expect(test.vision.poll(token).command?.url).toBe('https://media.example/first.webm')
    test.vision.watch('play', 'https://media.example/second.webm')
    const command = test.vision.poll(token).command!
    expect(command.url).toBe('https://media.example/second.webm')
    test.vision.playbackEnded(token, command.id, true)
    expect(test.vision.snapshot()).toMatchObject({ authorizedVideo: true, watching: false, playbackError: 'media-unavailable' })
  })
})
