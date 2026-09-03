import { ArrowDown, ArrowRight, ArrowUp, PlaneTakeoff } from 'lucide-react'
import { haversineMeters, routeLength } from '../sim/geo'
import type { AircraftState, Profile, Route } from '../types'

interface VerticalProfileProps {
  route: Route
  secureState: AircraftState
  vulnerableState: AircraftState
  secureHistory: AircraftState[]
  vulnerableHistory: AircraftState[]
}

const WIDTH = 1000
const HEIGHT = 220
const LEFT = 56
const RIGHT = 20
const TOP = 20
const BOTTOM = 32

const phaseArrow = (state: AircraftState) => state.verticalSpeedFpm > 100
  ? <ArrowUp size={14} />
  : state.verticalSpeedFpm < -100
    ? <ArrowDown size={14} />
    : <ArrowRight size={14} />

const vsi = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value / 10) * 10).toLocaleString()} fpm`

function PhaseReadout({ profile, state }: { profile: Profile; state: AircraftState }) {
  return (
    <div className={`vertical-phase-readout ${profile} phase-${state.flightPhase.toLowerCase().replaceAll(' ', '-')}`}>
      <i>{phaseArrow(state)}</i>
      <div><span>{profile === 'secure' ? 'ALB Secure' : 'ALB Vulnerable'}</span><strong>{state.flightPhase}</strong></div>
      <div><span>Altitude</span><strong>{Math.round(state.altitudeFt).toLocaleString()} ft</strong></div>
      <div><span>Vertical speed</span><strong>{vsi(state.verticalSpeedFpm)}</strong></div>
    </div>
  )
}

function sampled(states: AircraftState[]): AircraftState[] {
  if (states.length <= 500) return states
  const stride = Math.ceil(states.length / 500)
  return states.filter((_, index) => index % stride === 0 || index === states.length - 1)
}

export function VerticalProfile({ route, secureState, vulnerableState, secureHistory, vulnerableHistory }: VerticalProfileProps) {
  const totalM = routeLength(route)
  const observedMax = Math.max(
    ...route.points.map((point) => point.altitude_ft),
    ...secureHistory.map((state) => state.altitudeFt),
    ...vulnerableHistory.map((state) => state.altitudeFt),
  )
  const minimumAirportFt = Math.min(route.points[0].altitude_ft, route.points.at(-1)!.altitude_ft)
  const minAltitudeFt = Math.max(0, Math.floor((minimumAirportFt - 500) / 1_000) * 1_000)
  const maxAltitudeFt = Math.ceil((observedMax + 1_000) / 1_000) * 1_000
  const altitudeRangeFt = Math.max(1, maxAltitudeFt - minAltitudeFt)
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const x = (alongM: number) => LEFT + Math.min(1, Math.max(0, alongM / totalM)) * plotWidth
  const y = (altitudeFt: number) => TOP + (1 - (altitudeFt - minAltitudeFt) / altitudeRangeFt) * plotHeight

  let cumulativeM = 0
  const planned = route.points.map((point, index) => {
    if (index > 0) cumulativeM += haversineMeters(route.points[index - 1], point)
    return `${x(cumulativeM)},${y(point.altitude_ft)}`
  }).join(' ')
  const historyPoints = (states: AircraftState[]) => sampled(states).map((state) => `${x(state.alongTrackM)},${y(state.altitudeFt)}`).join(' ')
  const securePoints = historyPoints(secureHistory)
  const vulnerablePoints = historyPoints(vulnerableHistory)
  const gridAltitudes = [minAltitudeFt, minAltitudeFt + altitudeRangeFt / 2, maxAltitudeFt]

  return (
    <section className="panel vertical-profile-panel" aria-label="Planned and actual vertical flight profile">
      <header>
        <div><span className="eyebrow"><PlaneTakeoff size={13} /> Vertical flight path</span><h3>Takeoff, climb, cruise and descent</h3></div>
      </header>
      <div className="vertical-phase-grid">
        <PhaseReadout profile="secure" state={secureState} />
        <PhaseReadout profile="vulnerable" state={vulnerableState} />
      </div>
      <div className="vertical-chart-shell">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Vertical route profile from ${route.origin} to ${route.destination}`} preserveAspectRatio="none">
          {gridAltitudes.map((altitude) => (
            <g key={altitude}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(altitude)} y2={y(altitude)} className="vertical-gridline" />
              <text x={LEFT - 8} y={y(altitude) + 3} textAnchor="end">{Math.round(altitude).toLocaleString()}</text>
            </g>
          ))}
          <polyline points={planned} className="vertical-planned-path" />
          {securePoints && <polyline points={securePoints} className="vertical-actual-path secure" />}
          {vulnerablePoints && <polyline points={vulnerablePoints} className="vertical-actual-path vulnerable" />}
          <circle cx={x(secureState.alongTrackM)} cy={y(secureState.altitudeFt)} r="4" className="vertical-current secure" />
          <circle cx={x(vulnerableState.alongTrackM)} cy={y(vulnerableState.altitudeFt)} r="4" className="vertical-current vulnerable" />
          <text x={LEFT} y={HEIGHT - 8}>{route.origin.split(' / ')[0]}</text>
          <text x={WIDTH - RIGHT} y={HEIGHT - 8} textAnchor="end">{route.destination.split(' / ')[0]}</text>
          <text x="10" y={TOP + plotHeight / 2} transform={`rotate(-90 10 ${TOP + plotHeight / 2})`} textAnchor="middle">ALTITUDE FT MSL</text>
        </svg>
      </div>
      <div className="vertical-profile-legend">
        <span><i className="planned" /> planned route altitude</span>
        <span><i className="secure" /> ALB Secure actual</span>
        <span><i className="vulnerable" /> ALB Vulnerable actual</span>
      </div>
    </section>
  )
}
