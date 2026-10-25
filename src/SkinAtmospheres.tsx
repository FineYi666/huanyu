import type { CSSProperties } from 'react'

const gildedSparks = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 71 + 13) % 100}%`,
  delay: `${((i * 5) % 7) * 1.6}s`,
  duration: `${9 + (i % 5) * 2}s`,
  size: 1 + (i % 2),
}))
type SceneKind = 'synth' | 'glacier'
const snow = Array.from({ length: 36 }, (_, i) => ({
  left: `${(i * 47 + 5) % 100}%`,
  delay: `${-((i * 7.13) % 31)}s`,
  duration: `${18 + (i % 7) * 2.5}s`,
  size: i % 5 === 0 ? 5 : 1.5 + i % 3,
  drift: `${(i % 2 ? 1 : -1) * (18 + i % 4 * 12)}px`,
}))

// Decorative only. Parent CSS pauses motion in hidden tabs, during playback,
// with the appearance switch off, and for the system reduced-motion preference.
export function SceneWeather({ kind, compact = false }: { kind: SceneKind; compact?: boolean }) {
  return <div className={`scene-weather scene-weather-${kind}`} aria-hidden="true">
    {kind === 'glacier' ? <>
      <div className="winter-mist" />
      {snow.slice(0, compact ? 20 : 36).map((flake, i) => <span key={i} className={`snowfall-track ${i % 5 === 0 ? 'snow-near' : 'snow-far'}`} style={{ left: flake.left, animationDelay: flake.delay, animationDuration: flake.duration, '--snow-drift': flake.drift } as CSSProperties}><i style={{ width: flake.size, height: flake.size }} /></span>)}
    </> : <>
      <div className="retro-grid-plane"><div className="retro-grid-lines" /></div>
      <div className="city-glow" />
      <i className="neon-trail trail-one" /><i className="neon-trail trail-two" />
    </>}
  </div>
}
export function SynthAtmosphere() {
  return <div className="synth-atmosphere scene-atmosphere" aria-hidden="true"><div className="scene-landscape" /><div className="scene-tint" /><SceneWeather kind="synth" /></div>
}

export function GildedAtmosphere() {
  return (
    <div className="gilded-atmosphere scene-atmosphere" aria-hidden="true">
      <div className="scene-landscape" />
      <div className="scene-tint" />
      <div className="gilded-dust">
        {gildedSparks.map((spark, i) => (
          <i
            key={i}
            style={
              {
                left: spark.left,
                width: spark.size,
                height: spark.size,
                animationDelay: spark.delay,
                animationDuration: spark.duration,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}

export function EmberAtmosphere() {
  return (
    <div className="ember-atmosphere scene-atmosphere" aria-hidden="true">
      <div className="scene-landscape" />
      <div className="scene-tint" />
    </div>
  )
}

export function LunarAtmosphere() {
  return (
    <div className="lunar-atmosphere scene-atmosphere" aria-hidden="true">
      <div className="scene-landscape" />
      <div className="scene-tint" />
    </div>
  )
}

export function AuroraAtmosphere() {
  return (
    <div className="aurora-atmosphere scene-atmosphere" aria-hidden="true">
      <div className="scene-landscape" />
      <div className="scene-tint" />
    </div>
  )
}

export function GroveAtmosphere() {
  return (
    <div className="grove-atmosphere scene-atmosphere" aria-hidden="true">
      <div className="scene-landscape" />
      <div className="scene-tint" />
    </div>
  )
}

export function GlacierAtmosphere() {
  return <div className="glacier-atmosphere scene-atmosphere" aria-hidden="true"><div className="scene-landscape" /><div className="scene-tint" /><SceneWeather kind="glacier" /></div>
}
