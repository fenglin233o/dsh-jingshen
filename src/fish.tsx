import type { CSSProperties } from 'react'
import css from './fish.css?raw'

export const fishCss = css

export type FishActivity = 'working' | 'observing' | 'video' | 'sleep' | 'idle'
export type FishMood = 'smile' | 'sad' | 'surprise' | 'curious' | 'warm' | 'tired'
export interface SpiritFishProps {
  activity: FishActivity
  speaking?: boolean
  onCall?: boolean
  mood?: FishMood | null
  variant?: 'portrait'
  className?: string
  style?: CSSProperties
}

type FishScene = FishActivity | 'call'
type PosePoint = readonly [left: number, top: number]
type Cadence = 'typing' | 'scrolling' | 'speech' | 'blink'
type Sheet = 'activity' | 'social' | 'social-rest'
interface Sprite {
  sheet: Sheet
  frame: number
}
interface FishPose extends Sprite {
  /** Offsets account for the drawn silhouette within each square atlas cell. */
  center: PosePoint
  mouth: PosePoint
  portrait: PosePoint
  hair?: PosePoint
  tail?: PosePoint
  alternate?: { frame: number; align: PosePoint; cadence: Cadence; sheet?: Sheet }
  ear?: PosePoint
}

const fishAssets = '/personal-spirit/assets/fish/'
const phone: FishPose = {
  sheet: 'activity', frame: 2, center: [-.4, 1.7], mouth: [44.7, 51], portrait: [44.8, 46.2],
  hair: [75, 64], tail: [83, 70],
}
const active: Record<Exclude<FishActivity, 'idle'>, FishPose> = {
  working: { sheet: 'activity', frame: 0, center: [-6.25, 1.85], mouth: [50.8, 50.6], portrait: [50.8, 45],
    hair: [80, 62], tail: [89, 70], alternate: { frame: 1, align: [5.7, 0], cadence: 'typing' } },
  video: { ...phone, alternate: { frame: 3, align: [-3.5, -.2], cadence: 'scrolling' } },
  observing: { sheet: 'activity', frame: 5, center: [2.7, .6], mouth: [38.4, 43], portrait: [38.2, 38],
    hair: [66, 57], tail: [78, 69] },
  sleep: { sheet: 'activity', frame: 4, center: [5.3, -6.3], mouth: [46, 64], portrait: [48, 60],
    hair: [24, 70], tail: [80, 72] },
}
const neutral: FishPose = { sheet: 'social', frame: 0, center: [-7, .7], mouth: [54, 44], portrait: [54, 38],
  hair: [77, 59], tail: [87, 70], ear: [84, 37],
  alternate: { sheet: 'social-rest', frame: 0, align: [0, 0], cadence: 'blink' } }
const conversing: FishPose = { sheet: 'social-rest', frame: 1, center: [-2.8, .8], mouth: [46, 43.2], portrait: [46, 37],
  hair: [74, 59], tail: [80, 70], ear: [78, 37] }
const social: Partial<Record<FishMood, FishPose>> = {
  smile: { ...conversing, frame: 2, center: [0, .7], mouth: [47.1, 42.6], portrait: [47, 36], ear: [76, 34] },
  sad: { ...conversing, frame: 3, center: [-8.4, 1.1], mouth: [54.7, 44.5], portrait: [54, 40], ear: [83, 34], tail: [87, 71] },
  surprise: { ...conversing, frame: 4, center: [-1.9, 1.1], mouth: [49.8, 41.4], portrait: [50, 36], ear: [79, 35] },
  warm: { ...conversing, frame: 5, center: [-2.1, 1.1], mouth: [45.7, 44.1], portrait: [46, 39], ear: [76, 34] },
}

function spriteStyle({ sheet, frame }: Sprite): CSSProperties {
  return {
    backgroundImage: `url("${fishAssets}${sheet}.png")`,
    backgroundSize: '300% 200%',
    backgroundPosition: `${50 * (frame % 3)}% ${100 * Math.floor(frame / 3)}%`,
  }
}

function anchor([left, top]: PosePoint): CSSProperties {
  return { '--fish-x': `${left}%`, '--fish-y': `${top}%` } as CSSProperties
}

/** Visual states only reflect inputs supplied by the host. Mood is optional and cannot replace a task pose. */
export function SpiritFish({ activity, speaking = false, onCall = false, mood, variant, className, style }: SpiritFishProps) {
  const scene: FishScene = activity === 'working' || activity === 'video'
    ? activity : onCall ? 'call' : activity === 'sleep' && speaking ? 'idle' : activity
  const expression = scene === 'sleep' ? undefined : mood ?? undefined
  const socialPose = expression && social[expression]
  const conversational = scene === 'idle' || scene === 'call'
  const pose = conversational ? socialPose || (speaking || onCall ? conversing : neutral) : active[scene]
  const alternate: FishPose['alternate'] = conversational && speaking
    ? { sheet: 'social', frame: pose.frame, align: [0, 0], cadence: 'speech' } : pose.alternate
  const artwork = spriteStyle(pose)

  return <span aria-hidden="true" className={className ? `spirit-fish ${className}` : 'spirit-fish'} style={style}
    data-activity={activity} data-scene={scene} data-speaking={speaking || undefined} data-on-call={onCall || undefined}
    data-mood={expression} data-variant={variant} data-cadence={alternate?.cadence}>
    <span className="spirit-fish-stage" style={{ ...anchor(pose.portrait), '--fish-center': `${pose.center[0]}% ${pose.center[1]}%` } as CSSProperties}>
      <span className="spirit-fish-framing">
        <span className="spirit-fish-rhythm">
          <span className="spirit-fish-attitude" key={expression ?? 'plain'}>
            <span className="spirit-fish-original">
              <span className="spirit-fish-art" style={artwork} />
              {pose.hair && <span className="spirit-fish-part spirit-fish-hair" style={{ ...artwork, ...anchor(pose.hair) }} />}
              {pose.tail && <span className="spirit-fish-part spirit-fish-tail" style={{ ...artwork, ...anchor(pose.tail) }} />}
            </span>
            {alternate && <span className="spirit-fish-alt" style={{ ...spriteStyle({ sheet: alternate.sheet ?? pose.sheet, frame: alternate.frame }),
              ...anchor(pose.mouth), translate: `${alternate.align[0]}% ${alternate.align[1]}%` }} />}
            {speaking && alternate?.cadence !== 'speech' && <span className="spirit-fish-mouth" style={anchor(pose.mouth)} />}
            {scene === 'call' && pose.ear && <span className="spirit-fish-earwave" style={anchor(pose.ear)}><i /><i /></span>}
            {expression && <span className="spirit-fish-accent" style={anchor(pose.portrait)}><i /><i /></span>}
          </span>
        </span>
      </span>
    </span>
  </span>
}
