// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { SpiritFish, type SpiritFishProps } from '../src/fish.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(props: SpiritFishProps) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = async (value: SpiritFishProps) => {
    await act(async () => root?.render(<button aria-label="打开精神"><SpiritFish {...value} /></button>))
    return container.querySelector<HTMLElement>('.spirit-fish')!
  }
  await render(props)
  return { container, render }
}

function artwork(fish: HTMLElement, selector = '.spirit-fish-art') {
  return fish.querySelector<HTMLElement>(selector)?.style
}

it('keeps a decorative fish inside the labelled entry and animates typing while a social mood is present', async () => {
  const view = await mount({ activity: 'working', mood: 'smile', speaking: true, onCall: true })
  const button = view.container.querySelector('button')!
  const fish = button.firstElementChild as HTMLElement
  expect(button.getAttribute('aria-label')).toBe('打开精神')
  expect(button.querySelector('button, [tabindex], [role]')).toBeNull()
  expect(fish.getAttribute('aria-hidden')).toBe('true')
  expect(fish.dataset).toMatchObject({ scene: 'working', speaking: 'true', onCall: 'true', mood: 'smile', cadence: 'typing' })
  expect(artwork(fish)?.backgroundImage).toContain('/activity.png')
  expect(artwork(fish)?.backgroundPosition).toBe('0% 0%')
  expect(artwork(fish, '.spirit-fish-alt')?.backgroundPosition).toBe('50% 0%')
  expect(fish.querySelector('.spirit-fish-mouth')).not.toBeNull()
})

it('uses mobile frames during actual video and a standing voice pose for an audio-only call', async () => {
  const view = await mount({ activity: 'video' })
  const video = await view.render({ activity: 'video', onCall: true, mood: 'sad' })
  expect(video.dataset).toMatchObject({ scene: 'video', mood: 'sad', cadence: 'scrolling' })
  expect(artwork(video)?.backgroundPosition).toBe('100% 0%')
  expect(artwork(video, '.spirit-fish-alt')?.backgroundPosition).toBe('0% 100%')

  const call = await view.render({ activity: 'idle', onCall: true, mood: 'sad', variant: 'portrait' })
  expect(call.dataset).toMatchObject({ scene: 'call', mood: 'sad', variant: 'portrait' })
  expect(call.dataset.cadence).toBeUndefined()
  expect(artwork(call)?.backgroundImage).toContain('/social-rest.png')
  expect(call.querySelector('.spirit-fish-earwave')).not.toBeNull()
  expect(call.querySelector('.spirit-fish-mouth, .spirit-fish-alt')).toBeNull()

  const speaking = await view.render({ activity: 'idle', onCall: true, mood: 'sad', speaking: true })
  expect(speaking.dataset).toMatchObject({ scene: 'call', mood: 'sad', cadence: 'speech' })
  expect(artwork(speaking, '.spirit-fish-alt')?.backgroundImage).toContain('/social.png')
  expect(artwork(speaking, '.spirit-fish-alt')?.backgroundPosition).toBe(artwork(speaking)?.backgroundPosition)
})

it('uses sleep and observation artwork with no invented speech, and rests with an unadorned blink', async () => {
  const view = await mount({ activity: 'sleep' })
  const sleeping = await view.render({ activity: 'sleep', mood: 'surprise' })
  expect(sleeping.dataset.scene).toBe('sleep')
  expect(sleeping.dataset.mood).toBeUndefined()
  expect(artwork(sleeping)?.backgroundPosition).toBe('50% 100%')
  expect(sleeping.querySelector('.spirit-fish-mouth, .spirit-fish-earwave, .spirit-fish-alt')).toBeNull()
  const observing = await view.render({ activity: 'observing' })
  expect(artwork(observing)?.backgroundPosition).toBe('100% 100%')
  expect(observing.dataset.speaking).toBeUndefined()
  const idle = await view.render({ activity: 'idle', mood: null })
  expect(idle.dataset).toMatchObject({ scene: 'idle', cadence: 'blink' })
  expect(idle.dataset.mood).toBeUndefined()
  expect(idle.querySelector('.spirit-fish-mouth, .spirit-fish-earwave, .spirit-fish-accent')).toBeNull()
})
