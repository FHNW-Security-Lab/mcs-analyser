import { useMemo, useState, type FormEvent } from 'react'
import { Braces, LoaderCircle, Play, ShieldCheck, TriangleAlert } from 'lucide-react'
import { computeInverseReachability } from '../api'
import type {
  AircraftState,
  AttackScenario,
  InverseProfileResult,
  InverseReachabilityResult,
  InverseTarget,
  InverseTargetField,
  McaArtifact,
  Profile,
} from '../types'
import { StatusPill } from './StatusPill'

interface InverseReachabilityQueryProps {
  artifacts: Partial<Record<Profile, McaArtifact>>
  scenario: AttackScenario
  secureState: AircraftState
  vulnerableState: AircraftState
  runQuery?: typeof computeInverseReachability
}

interface TargetMeta {
  label: string
  unit: string
  minimum: number
  maximum: number
  initial: number
  current: (state: AircraftState) => number
}

const targetMeta: Record<InverseTargetField, TargetMeta> = {
  roll_deg: { label: 'Roll angle', unit: 'deg', minimum: -55, maximum: 55, initial: 36, current: (state) => state.rollDeg },
  pitch_deg: { label: 'Pitch angle', unit: 'deg', minimum: -28, maximum: 28, initial: 24, current: (state) => state.pitchDeg },
  yaw_rate_deg_s: { label: 'Yaw rate', unit: 'deg/s', minimum: -2.5, maximum: 2.5, initial: 2, current: (state) => state.yawRateDegS },
  heading_error_deg: { label: 'Heading error', unit: 'deg', minimum: -90, maximum: 90, initial: 25, current: () => 0 },
  course_deviation_nm: { label: 'Course deviation', unit: 'NM', minimum: -80, maximum: 80, initial: 5, current: (state) => state.crossTrackM / 1852 },
  altitude_deviation_ft: { label: 'Altitude deviation', unit: 'ft', minimum: -12000, maximum: 8000, initial: -2000, current: (state) => state.altitudeFt - state.targetAltitudeFt },
}

const displayName = (value: string) => value.replace(/^MSG_AFDX_VL_/, '').replaceAll('_', ' ').toLowerCase()

function ProfileQueryResult({
  profile,
  data,
  artifact,
}: {
  profile: Profile
  data: InverseProfileResult
  artifact: McaArtifact | undefined
}) {
  const tone = data.status === 'sat' ? 'unsafe' : data.status === 'unsat' ? 'recovered' : 'warning'
  const componentNames = new Map((artifact?.components ?? artifact?.nodes ?? []).map((component) => [String(component.id), component.name]))

  return (
    <article className={`reach-profile ${profile} classification-${data.status === 'sat' ? 'unsafe' : data.status === 'unsat' ? 'bounded-safe' : 'unknown'}`}>
      <header>
        <div><span>{profile} aircraft</span><strong>{data.status === 'sat' ? 'Target reachable' : data.status === 'unsat' ? 'Target not reached in bound' : 'Solver unknown'}</strong></div>
        {data.status === 'sat' ? <TriangleAlert size={23} /> : data.status === 'unsat' ? <ShieldCheck size={23} /> : <Braces size={23} />}
      </header>
      <div className="inverse-result-status"><StatusPill tone={tone}>{data.status.toUpperCase()}</StatusPill><span>{data.constraint_count.toLocaleString()}</span><span>{data.witness_seconds == null ? '—' : `T+${data.witness_seconds}s`}</span></div>

      {data.witness_inputs.length > 0 && (
        <div className="inverse-chip-flow" aria-label="Witness inputs">
          {data.witness_inputs.map((input) => (
            <span className="inverse-chip witness" key={`${input.input}-${input.seconds}`}><strong>{displayName(input.input)}</strong><b>{input.value.toLocaleString()} {input.unit}</b><small>T+{input.seconds}s</small></span>
          ))}
        </div>
      )}

      {data.individually_enabling_scenarios.length > 0 && (
        <div className="inverse-scenario-flows" aria-label="Enabling component chains">
          {data.individually_enabling_scenarios.map((item) => (
            <div className="inverse-chain" key={item.id}><span>{item.title}</span>{item.native_components.map((id) => <strong key={id}>{componentNames.get(id) ?? id}</strong>)}</div>
          ))}
        </div>
      )}

      {data.combination_required && <StatusPill tone="warning">Combined inputs</StatusPill>}

      {data.blocking_evidence.length > 0 && (
        <div className="inverse-chip-flow blockers" aria-label="Blocking components">
          {[...new Map(data.blocking_evidence.map((item) => [item.component_id, item])).values()].map((item) => (
            <span className="inverse-chip blocker" title={`${item.decision} · ${item.scenario_title}`} key={item.component_id}><ShieldCheck size={14} /><strong>{componentNames.get(item.component_id) ?? item.component_id}</strong></span>
          ))}
        </div>
      )}
    </article>
  )
}

export function InverseReachabilityQuery({ artifacts, scenario, vulnerableState, runQuery = computeInverseReachability }: InverseReachabilityQueryProps) {
  const [field, setField] = useState<InverseTargetField>('roll_deg')
  const [value, setValue] = useState(targetMeta.roll_deg.initial)
  const [scope, setScope] = useState<'all' | 'focused'>('all')
  const [result, setResult] = useState<InverseReachabilityResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meta = targetMeta[field]
  const targetPose = useMemo(() => ({
    roll: field === 'roll_deg' ? value : vulnerableState.rollDeg,
    pitch: field === 'pitch_deg' ? value : vulnerableState.pitchDeg,
    yaw: field === 'yaw_rate_deg_s' || field === 'heading_error_deg' ? value : vulnerableState.yawRateDegS,
    course: field === 'course_deviation_nm' ? value : vulnerableState.crossTrackM / 1852,
    altitude: field === 'altitude_deviation_ft' ? value : vulnerableState.altitudeFt - vulnerableState.targetAltitudeFt,
  }), [field, value, vulnerableState])

  const changeField = (next: InverseTargetField) => {
    setField(next)
    setValue(targetMeta[next].initial)
    setResult(null)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const target: InverseTarget = { [field]: value }
    setLoading(true)
    setError(null)
    try {
      setResult(await runQuery(target, scope === 'focused' ? [scenario.id] : undefined, 90, 6))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Inverse reachability query failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="constraint-view" aria-label="Backward constraint/query analysis">
      <form onSubmit={(event) => void submit(event)}>
        <div className="reach-run-controls" style={{ justifyContent: 'flex-start', margin: '13px 0', flexWrap: 'wrap' }}>
          <label>Target field
            <select aria-label="Target aircraft state field" value={field} onChange={(event) => changeField(event.target.value as InverseTargetField)} style={{ width: 170 }}>
              {(Object.entries(targetMeta) as Array<[InverseTargetField, TargetMeta]>).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}
            </select>
          </label>
          <label>Requested value
            <input aria-label={`Requested ${meta.label}`} type="number" min={meta.minimum} max={meta.maximum} step="0.1" value={value} onChange={(event) => { setValue(Number(event.target.value)); setResult(null) }} style={{ width: 88 }} /> {meta.unit}
          </label>
          <label>Scenario scope
            <select aria-label="Inverse query scenario scope" value={scope} onChange={(event) => { setScope(event.target.value as 'all' | 'focused'); setResult(null) }} style={{ width: 190 }}>
              <option value="all">All configured scenarios</option>
              <option value="focused">Focused: {scenario.title}</option>
            </select>
          </label>
          <button className="action-button primary" type="submit" disabled={loading || !Number.isFinite(value)}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}
            {loading ? 'Solving exact query…' : 'Run backward query'}
          </button>
        </div>
        <div className="inverse-target-editor">
          <div className="inverse-target-aircraft" aria-label={`Target pose preview: roll ${targetPose.roll.toFixed(1)} degrees, pitch ${targetPose.pitch.toFixed(1)} degrees`}>
            <svg viewBox="0 0 240 138" role="img" aria-label="Draggable target aircraft state preview">
              <defs>
                <linearGradient id="target-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#123e57" /><stop offset="1" stopColor="#215c78" /></linearGradient>
              </defs>
              <rect width="240" height="138" rx="3" fill="#071419" />
              <g>
                <rect x="-22" y={Math.max(-30, Math.min(106, 69 + targetPose.pitch * 1.15)) - 80} width="284" height="80" fill="url(#target-sky)" />
                <rect x="-22" y={Math.max(-30, Math.min(106, 69 + targetPose.pitch * 1.15))} width="284" height="100" fill="#62452f" />
                <line x1="-22" x2="262" y1={Math.max(-30, Math.min(106, 69 + targetPose.pitch * 1.15))} y2={Math.max(-30, Math.min(106, 69 + targetPose.pitch * 1.15))} stroke="#e4ece9" strokeWidth="2" />
              </g>
              <g transform={`translate(${Math.max(-18, Math.min(18, targetPose.course * 1.8))} ${Math.max(-9, Math.min(9, -targetPose.altitude / 1800))}) rotate(${targetPose.roll} 120 73)`} fill="none" stroke="#f5c24b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M75 72 L108 76 L118 70 L120 43 L122 70 L132 76 L165 72" />
                <circle cx="120" cy="76" r="3" fill="#071419" />
              </g>
              <path d="M120 7 L116 15 H124 Z" fill="#dfeae7" />
              <text x="10" y="126">TARGET POSE</text>
              <text x="230" y="126" textAnchor="end">R {targetPose.roll >= 0 ? '+' : ''}{targetPose.roll.toFixed(1)}° · P {targetPose.pitch >= 0 ? '+' : ''}{targetPose.pitch.toFixed(1)}° · Y {targetPose.yaw >= 0 ? '+' : ''}{targetPose.yaw.toFixed(1)}°</text>
            </svg>
          </div>
          <label className="inverse-target-slider">
            <span><strong>{meta.label}</strong><em>{meta.minimum.toLocaleString()} to {meta.maximum.toLocaleString()} {meta.unit}</em></span>
            <input
              aria-label={`Move target ${meta.label}`}
              type="range"
              min={meta.minimum}
              max={meta.maximum}
              step="0.1"
              value={value}
              onChange={(event) => { setValue(Number(event.target.value)); setResult(null) }}
            />
            <output>{value >= 0 ? '+' : ''}{value.toLocaleString()} {meta.unit}</output>
          </label>
        </div>
      </form>

      {error && <div className="inline-error"><TriangleAlert size={16} /><span>{error}</span></div>}

      {result && (
          <div className="profile-result-grid" style={{ marginTop: 12 }}>
            <ProfileQueryResult profile="secure" data={result.profiles.secure} artifact={artifacts.secure} />
            <ProfileQueryResult profile="vulnerable" data={result.profiles.vulnerable} artifact={artifacts.vulnerable} />
          </div>
      )}
    </div>
  )
}
