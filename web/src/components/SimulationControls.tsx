import { Pause, Play, RotateCcw, TimerReset } from 'lucide-react'
import type { FlightPhase, Route } from '../types'

interface SimulationControlsProps {
  routes: Route[]
  routeId: string
  onRouteChange: (id: string) => void
  playing: boolean
  onPlayToggle: () => void
  onReset: () => void
  time: number
  flightPhase: FlightPhase
  horizon: number
  speed: number
  onSpeedChange: (speed: number) => void
}

const formatTime = (seconds: number) => {
  const value = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function SimulationControls(props: SimulationControlsProps) {
  return (
    <section className="mission-control panel" aria-label="Simulation controls">
      <div className="route-control field-group">
        <label htmlFor="route-select">Mission route</label>
        <select id="route-select" value={props.routeId} onChange={(event) => props.onRouteChange(event.target.value)}>
          {props.routes.map((route) => <option value={route.id} key={route.id}>{route.name}</option>)}
        </select>
      </div>
      <div className="transport-controls">
        <button className="icon-button primary" onClick={props.onPlayToggle} aria-label={props.playing ? 'Pause simulation' : 'Play simulation'}>
          {props.playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
        </button>
        <button className="icon-button" onClick={props.onReset} aria-label="Reset simulation"><RotateCcw size={17} /></button>
      </div>
      <div className="timeline-control">
        <div className="timeline-label">
          <span><TimerReset size={14} /> Scenario time <i className={`phase-chip phase-${props.flightPhase.toLowerCase().replaceAll(' ', '-')}`}>{props.flightPhase}</i></span>
          <strong>T+ {formatTime(props.time)}</strong>
        </div>
        <div className="progress-track" aria-label={`${Math.round(props.time)} of ${props.horizon} seconds`}>
          <span style={{ width: `${Math.min(100, props.time / props.horizon * 100)}%` }} />
        </div>
      </div>
      <div className="speed-control" aria-label="Simulation speed">
        {[1, 4, 16, 64].map((speed) => (
          <button key={speed} className={props.speed === speed ? 'active' : ''} onClick={() => props.onSpeedChange(speed)}>{speed}×</button>
        ))}
      </div>
    </section>
  )
}
