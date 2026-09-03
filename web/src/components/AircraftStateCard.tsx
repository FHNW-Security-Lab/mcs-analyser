import type { AircraftState, Profile } from '../types'

interface AircraftStateCardProps {
  profile: Profile
  state: AircraftState
}

const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}°`

export function AircraftStateCard({ profile, state }: AircraftStateCardProps) {
  const courseDeviationNm = state.crossTrackM / 1852

  return (
    <section
      aria-label={`${profile} live aircraft physical state`}
      className="scenario-constraint-card"
      style={{ borderColor: profile === 'secure' ? 'rgba(79, 209, 181, .32)' : 'rgba(240, 125, 99, .34)' }}
    >
      <div className="constraint-heading">
        <div><span>Physical aircraft state</span><strong>ALB {profile === 'secure' ? 'Secure' : 'Vulnerable'}</strong></div>
        <em>live plant</em>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', alignItems: 'center', margin: '11px 0', gap: 10 }}>
        <svg viewBox="0 0 100 100" role="img" aria-label={`Aircraft heading ${state.headingDeg.toFixed(0)} degrees`} style={{ width: 72, height: 72, color: profile === 'secure' ? '#4fd1b5' : '#f07d63' }}>
          <circle cx="50" cy="50" r="46" fill="#071419" stroke="currentColor" strokeOpacity=".32" />
          <g transform={`rotate(${state.headingDeg} 50 50)`} fill="currentColor">
            <path d="M50 7 L56 38 L86 55 L84 63 L56 53 L55 78 L66 88 L63 93 L50 87 L37 93 L34 88 L45 78 L44 53 L16 63 L14 55 L44 38 Z" />
          </g>
          <path d="M50 3 L46 11 L54 11 Z" fill="#dce9e7" />
        </svg>
        <div>
          <strong style={{ display: 'block', fontSize: 13 }}>{state.headingDeg.toFixed(0)}° true</strong>
        </div>
      </div>
      <dl className="inspector-facts">
        <div><dt>Roll</dt><dd>{signed(state.rollDeg)}</dd></div>
        <div><dt>Pitch</dt><dd>{signed(state.pitchDeg)}</dd></div>
        <div><dt>Yaw rate</dt><dd>{signed(state.yawRateDegS)} /s</dd></div>
        <div><dt>Angle of attack</dt><dd>{signed(state.angleOfAttackDeg)}</dd></div>
        <div><dt>Altitude</dt><dd>{Math.round(state.altitudeFt).toLocaleString()} ft MSL</dd></div>
        <div><dt>Course deviation</dt><dd>{courseDeviationNm >= 0 ? '+' : '−'}{Math.abs(courseDeviationNm).toFixed(2)} NM</dd></div>
      </dl>
      <div className="channel-chip-list" aria-label="Aircraft external and physical interfaces">
        <span title="Antenna environment and GNSS receiver boundary">GNSS / RF</span>
        <span title="Electronic flight bag and route database loading boundary">Data loading / EFB</span>
        <span title="AFDX publisher and adversarial control-domain boundary">AFDX / control ingress</span>
        <span title="Radio navigation and dual radio-altimeter receive paths">Radio nav / altimeter</span>
        <span title="Weather disturbance inputs and physical aircraft response">Weather / plant</span>
      </div>
      <small>T+{Math.round(state.time)} s · {state.flightPhase} · {state.busHealth}</small>
    </section>
  )
}
