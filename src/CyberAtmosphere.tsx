import type { CSSProperties } from 'react'

const towers = [42, 65, 34, 80, 53, 95, 62, 44, 78, 55, 88, 39]
export default function CyberAtmosphere() {
  return (
    <div className="cyber-atmosphere" aria-hidden="true">
      <div className="cyber-horizon" />
      <div className="cyber-grid-plane" />
      <div className="cyber-skyline">
        {towers.map((height, i) => (
          <i
            key={i}
            style={
              {
                '--tower-height': `${height}%`,
                '--tower-width': `${4 + (i % 3) * 2}%`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="cyber-vertical-light" />
      <div className="cyber-corner-label">
        NEON DISTRICT <span>映屿 / 私人影院</span>
      </div>
    </div>
  )
}
