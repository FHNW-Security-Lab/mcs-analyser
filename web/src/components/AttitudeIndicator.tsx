import { Gauge } from 'lucide-react'
import type { AircraftState, Profile } from '../types'
import { signedDegrees } from '../sim/geo'

interface AttitudeIndicatorProps {
  profile: Profile
  state: AircraftState
}

export function AttitudeIndicator({ profile, state }: AttitudeIndicatorProps) {
  const horizonStyle = {
    transform: `translateY(${Math.max(-42, Math.min(42, state.pitchDeg * 2.05))}px) rotate(${-state.rollDeg}deg)`,
  }
  const unsafe = state.safetyViolations.length > 0

  return (
    <section className={`attitude-card panel profile-${profile}`} aria-label={`${profile} aircraft attitude`}>
      <header className="panel-header compact">
        <div>
          <div className="eyebrow">{profile === 'secure' ? 'Protected airframe' : 'Baseline airframe'}</div>
          <h3>{profile === 'secure' ? 'ALB Secure' : 'ALB Vulnerable'}</h3>
        </div>
        <span className={`flight-state ${unsafe ? 'danger' : state.busHealth === 'nominal' ? 'nominal' : 'warning'}`}>
          {unsafe ? 'ENVELOPE EXCEEDED' : state.busHealth === 'nominal' ? 'NOMINAL' : state.busHealth.toUpperCase()}
        </span>
      </header>

      <div className="attitude-layout">
        <div className="attitude-instrument" aria-label={`Roll ${state.rollDeg.toFixed(1)} degrees, pitch ${state.pitchDeg.toFixed(1)} degrees, angle of attack ${state.angleOfAttackDeg.toFixed(1)} degrees, flight-path angle ${state.flightPathAngleDeg.toFixed(1)} degrees`}>
          <div className="attitude-bank-index">◆</div>
          <div className="attitude-sphere">
            <div className="attitude-horizon" style={horizonStyle}>
              <div className="sky" />
              <div className="ground" />
              <div className="horizon-line" />
              {[-20, -10, 10, 20].map((pitch) => (
                <span className={`pitch-mark pitch-${pitch < 0 ? 'm' : 'p'}${Math.abs(pitch)}`} key={pitch}>{Math.abs(pitch)}</span>
              ))}
            </div>
            <div className="aircraft-reference"><i /><b /><i /></div>
          </div>
          <div className="attitude-readout">
            <span>ROL {signedDegrees(state.rollDeg)}</span>
            <span>PTC {signedDegrees(state.pitchDeg)}</span>
          </div>
        </div>

        <div className="flight-metrics">
          <div className="metric-block">
            <span>ALTITUDE</span>
            <strong>{Math.round(state.altitudeFt).toLocaleString()}</strong>
            <small>FT MSL</small>
          </div>
          <div className="metric-block">
            <span>HEADING</span>
            <strong>{Math.round(state.headingDeg).toString().padStart(3, '0')}°</strong>
            <small>TRUE</small>
          </div>
          <div className="metric-block">
            <span>AIRSPEED</span>
            <strong>{Math.round(state.airspeedKt)}</strong>
            <small>KTAS</small>
          </div>
          <div className="metric-block">
            <span>YAW RATE</span>
            <strong>{signedDegrees(state.yawRateDegS)}</strong>
            <small>DEG / S</small>
          </div>
          <div className="metric-block">
            <span>ANGLE OF ATTACK</span>
            <strong>{signedDegrees(state.angleOfAttackDeg)}</strong>
            <small>AOA α · ANSTELLWINKEL</small>
          </div>
          <div className="metric-block">
            <span>FLIGHT-PATH ANGLE</span>
            <strong>{signedDegrees(state.flightPathAngleDeg)}</strong>
            <small>FPA γ · STEIGUNGSWINKEL</small>
          </div>
        </div>
      </div>

      <div className="angle-relation-note" aria-label="Pitch equals flight-path angle plus angle of attack in still air">
        <span>PITCH θ</span><b>=</b><span>FLIGHT PATH γ</span><b>+</b><span>AOA α</span><small>STILL AIR</small>
      </div>

      <div className={`vertical-state-strip phase-${state.flightPhase.toLowerCase().replaceAll(' ', '-')}`}>
        <div><span>Flight phase</span><strong>{state.flightPhase}</strong></div>
        <div><span>Vertical speed</span><strong>{state.verticalSpeedFpm > 100 ? '↑ ' : state.verticalSpeedFpm < -100 ? '↓ ' : '→ '}{state.verticalSpeedFpm > 0 ? '+' : state.verticalSpeedFpm < 0 ? '−' : ''}{Math.abs(Math.round(state.verticalSpeedFpm / 10) * 10).toLocaleString()} FPM</strong></div>
        <div><span>Target altitude</span><strong>{Math.round(state.targetAltitudeFt).toLocaleString()} FT</strong></div>
      </div>

      <div className="state-strip">
        <div><span>Navigation mode</span><strong>{state.navMode}</strong></div>
        <div><span>Authoritative source</span><strong>{state.source}</strong></div>
        <div><span>Cross-track</span><strong className={Math.abs(state.crossTrackM) > 1852 ? 'text-danger' : ''}>{(state.crossTrackM / 1852).toFixed(2)} NM</strong></div>
      </div>
      {unsafe && (
        <div className="violation-banner"><Gauge size={15} /> Threshold violation: {state.safetyViolations.join(' · ')}</div>
      )}
    </section>
  )
}
