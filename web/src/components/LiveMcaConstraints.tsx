import { useMemo, useState } from 'react'
import { Braces, ChevronRight, Cpu, Network, ShieldCheck, TriangleAlert } from 'lucide-react'
import { explainConstraint, formatCapturedConstraint } from '../graph/mcaConstraints'
import { propagationStatus, scenarioIsEffective } from '../sim/engine'
import type { AircraftState, AttackScenario, McaArtifact, McaConstraint, Profile, PropagationStatus, SafetyLimits } from '../types'

interface LiveMcaConstraintsProps {
  secureState: AircraftState
  vulnerableState: AircraftState
  secureHeightAglFt: number
  vulnerableHeightAglFt: number
  attacks: AttackScenario[]
  safety: SafetyLimits
  artifacts: Partial<Record<Profile, McaArtifact>>
  profile: Profile
  onProfileChange: (profile: Profile) => void
  onOpenGraph: () => void
}

type RuntimeStatus = 'active' | 'attack' | 'blocked' | 'violated' | 'discovery' | 'standby'
type ConstraintMode = 'simple' | 'full'

interface ConstraintRow {
  type: string
  record: McaConstraint | null
  alternatives: number
  predicates: number
  component: string
  expression: string
  status: RuntimeStatus
}

const coreTypes = [
  'MSG_AFDX_VL_NAV_SOLUTION',
  'MSG_AFDX_VL_AIR_DATA',
  'MSG_AFDX_VL_ATTITUDE',
  'MSG_AFDX_VL_FLIGHT_GUIDANCE',
  'MSG_AFDX_VL_ENVELOPE_COMMAND',
] as const

const label = (type: string) => type.replace(/^MSG_AFDX_(VL_|A429_|ASD_DLS_)?/, '').replaceAll('_', ' ')

const expression = (type: string, profile: Profile, safety: SafetyLimits, predicates: number): string => {
  switch (type) {
    case 'MSG_AFDX_VL_NAV_SOLUTION': return profile === 'secure' ? '2 OF 3 NAV SOURCES AGREE + ROUTE CHECK PASSES' : 'GNSS FORMAT PASSES — NO SECOND SOURCE REQUIRED'
    case 'MSG_AFDX_VL_AIR_DATA': return 'SENSOR DATA PLAUSIBLE · SIMULATED AIRCRAFT STAYS ≤ 20,000 FT'
    case 'MSG_AFDX_VL_ATTITUDE': return 'ATTITUDE VALUES CAN BE DECODED'
    case 'MSG_AFDX_VL_FLIGHT_GUIDANCE': return 'GUIDANCE CHANGE LIMITED TO PITCH ±12° / ROLL ±25°'
    case 'MSG_AFDX_VL_ENVELOPE_COMMAND': return profile === 'secure' ? 'FINAL COMMAND LIMITED TO PITCH ±18° / ROLL ±32°' : 'NAV DIRECT CAN SKIP THE ±18° / ±32° LIMIT'
    case 'MSG_AFDX_VL_AIRCRAFT_ATTITUDE_STATE': return 'AIRCRAFT INSIDE PITCH ±18° / ROLL ±32°'
    case 'MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE': return 'AIRCRAFT EXCEEDS PITCH ±18° OR ROLL ±32°'
    case 'MSG_AFDX_VL_AIRCRAFT_POSITION_STATE': return `AIRCRAFT WITHIN ${safety.max_course_deviation_nm.toFixed(1)} NM OF ROUTE`
    case 'MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE': return `AIRCRAFT MORE THAN ${safety.max_course_deviation_nm.toFixed(1)} NM OFF ROUTE`
    case 'MSG_AFDX_VL_GNSS_POSITION': return 'GNSS COORDINATE HAS A VALID WORLD RANGE'
    case 'MSG_AFDX_VL_INS_POSITION': return 'INS POSITION IS INSIDE THE OPERATING REGION'
    case 'MSG_AFDX_VL_RADIO_POSITION': return 'RADIO FIX IS INSIDE NAVAID COVERAGE'
    case 'MSG_AFDX_VL_ACTUATOR_COMMAND': return 'MECHANICAL TRAVEL: PITCH ±25° / ROLL ±70°'
    default: return `${predicates} SYMBOLIC PREDICATE${predicates === 1 ? '' : 'S'}`
  }
}

function buildRows(
  artifact: McaArtifact | undefined,
  profile: Profile,
  state: AircraftState,
  heightAglFt: number,
  attacks: AttackScenario[],
  safety: SafetyLimits,
): ConstraintRow[] {
  if (!artifact) return []
  const effectiveAttacks = attacks.filter((attack) => scenarioIsEffective(attack, state.time, state.flightPhase, heightAglFt))
  const attackTypes = new Set(effectiveAttacks.flatMap((attack) => attack.evidence.message_types))
  const envelopeViolated = Math.abs(state.rollDeg) > 32 || Math.abs(state.pitchDeg) > 18
  const routeViolated = Math.abs(state.crossTrackM / 1852) > safety.max_course_deviation_nm
  const types = [...new Set<string>([
    ...coreTypes,
    envelopeViolated ? 'MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE' : 'MSG_AFDX_VL_AIRCRAFT_ATTITUDE_STATE',
    routeViolated ? 'MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE' : 'MSG_AFDX_VL_AIRCRAFT_POSITION_STATE',
    ...attackTypes,
  ])]
  const componentNames = new Map((artifact.components ?? artifact.nodes ?? []).map((item) => [String(item.id), item.name]))

  return types.map((type): ConstraintRow => {
    const records = (artifact.constraints ?? []).filter((item) => item.message_type_name === type)
    const record = records.find((item) => item.reachability === 'reachable_from_configured_sources') ?? records[0] ?? null
    const reachable = (artifact.messages ?? []).some((message) => message.type?.name === type && message.reachability === 'reachable_from_configured_sources')
      || records.some((item) => item.reachability === 'reachable_from_configured_sources')
    const producerId = String(record?.producer_component_id ?? '')
    const scenarioStatuses = effectiveAttacks
      .filter((attack) => attack.evidence.message_types.includes(type))
      .flatMap((attack) => attack.steps
        .map((step, index) => ({ step, status: propagationStatus(profile, attack, index, state.time, state.flightPhase, heightAglFt) }))
        .filter(({ step }) => step.component === producerId)
        .map(({ status }) => status))
    const blockedByProfile = scenarioStatuses.some((status: PropagationStatus) => status === 'blocked' || status === 'recovered')
    const unsafeByProfile = scenarioStatuses.some((status: PropagationStatus) => status === 'unsafe')
    const isRuntimeViolation = (type === 'MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE' && envelopeViolated)
      || (type === 'MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE' && routeViolated)
      || unsafeByProfile
    const status: RuntimeStatus = isRuntimeViolation
      ? 'violated'
      : blockedByProfile
        ? 'blocked'
      : attackTypes.has(type)
        ? 'attack'
        : type === 'MSG_AFDX_VL_AIR_DATA' && state.airspeedKt < 40
          ? 'standby'
          : reachable
            ? 'active'
            : 'discovery'
    const predicates = record?.predicates?.length ?? 0
    return {
      type,
      record,
      alternatives: records.length,
      predicates,
      component: componentNames.get(String(record?.producer_component_id ?? '')) ?? String(record?.producer_component_id ?? 'MCA message'),
      expression: expression(type, profile, safety, predicates),
      status,
    }
  })
}

const statusText: Record<RuntimeStatus, string> = {
  active: 'ACTIVE',
  attack: 'ATTACK PATH',
  blocked: 'BLOCKED',
  violated: 'VIOLATED',
  discovery: 'BLOCKED',
  standby: 'STANDBY',
}

export function LiveMcaConstraints({ secureState, vulnerableState, secureHeightAglFt, vulnerableHeightAglFt, attacks, safety, artifacts, profile, onProfileChange, onOpenGraph }: LiveMcaConstraintsProps) {
  const [selectedType, setSelectedType] = useState<string>('MSG_AFDX_VL_NAV_SOLUTION')
  const [mode, setMode] = useState<ConstraintMode>('simple')

  const rowsByProfile = useMemo(() => ({
    secure: buildRows(artifacts.secure, 'secure', secureState, secureHeightAglFt, attacks, safety),
    vulnerable: buildRows(artifacts.vulnerable, 'vulnerable', vulnerableState, vulnerableHeightAglFt, attacks, safety),
  }), [artifacts, secureState, vulnerableState, secureHeightAglFt, vulnerableHeightAglFt, attacks, safety])
  const rows = rowsByProfile[profile]
  const selected = rows.find((row) => row.type === selectedType) ?? rows[0]
  const artifact = artifacts[profile]
  const verified = artifact?.analysis?.completed_real_angr_run === true
  const activeCount = rows.filter((row) => row.status === 'active' || row.status === 'attack').length
  const violationCount = rows.filter((row) => row.status === 'violated').length
  const simplified = selected?.record ? explainConstraint(selected.record, profile) : null
  const full = selected?.record ? formatCapturedConstraint(selected.record) : 'NO CAPTURED SYMBOLIC RECORD'

  return (
    <section className={`panel live-mca-panel profile-${profile}`} aria-label="Live MCA constraints">
      <header className="live-mca-header">
        <div><span className="eyebrow"><Cpu size={12} /> Live MCA</span><h2>Active constraints</h2></div>
        <button type="button" className="graph-jump" onClick={onOpenGraph}><Network size={14} /><span>Graph</span></button>
      </header>

      <div className="live-mca-profile-tabs" role="tablist" aria-label="Live MCA aircraft profile">
        {(['secure', 'vulnerable'] as const).map((item) => {
          const itemRows = rowsByProfile[item]
          const itemViolations = itemRows.filter((row) => row.status === 'violated').length
          return <button role="tab" aria-selected={profile === item} className={profile === item ? 'active' : ''} onClick={() => onProfileChange(item)} key={item}><i className={itemViolations ? 'violated' : 'nominal'} />{item}<b>{itemRows.length}</b></button>
        })}
      </div>

      <div className="live-mca-kpis">
        <span className={verified ? 'verified' : 'loading'}><ShieldCheck size={12} />{verified ? 'REAL ANGR' : 'LOADING'}</span>
        <span><Braces size={12} />{activeCount} ACTIVE</span>
        <span className={violationCount ? 'violated' : ''}><TriangleAlert size={12} />{violationCount} VIOLATIONS</span>
      </div>

      <div className="live-constraint-list" role="list" aria-label={`${profile} active MCA constraint records`}>
        {rows.map((row) => (
          <button type="button" role="listitem" className={`live-constraint-row status-${row.status} ${selected?.type === row.type ? 'selected' : ''}`} onClick={() => { setSelectedType(row.type); setMode('simple') }} key={row.type}>
            <i />
            <span><strong>{label(row.type)}</strong><small>{row.component}</small><code>{row.expression}</code></span>
            <em>{statusText[row.status]}</em>
            <b>{row.predicates}P</b>
            <ChevronRight size={13} />
          </button>
        ))}
      </div>

      {selected && (
        <div className="live-constraint-inspector">
          <div className="constraint-mode-tabs" role="tablist" aria-label="Constraint rendering">
            <button role="tab" aria-selected={mode === 'simple'} className={mode === 'simple' ? 'active' : ''} onClick={() => setMode('simple')}>Simplified</button>
            <button role="tab" aria-selected={mode === 'full'} className={mode === 'full' ? 'active' : ''} onClick={() => setMode('full')}>Full</button>
            <span>#{selected.record?.message_id ?? '—'} · {selected.alternatives} paths</span>
          </div>
          {mode === 'simple'
            ? <div className="simple-constraint"><b>{selected.expression}</b>{simplified?.conditions.slice(0, 3).map((condition) => <span key={condition}>{condition}</span>)}</div>
            : <pre>{full}</pre>}
        </div>
      )}
    </section>
  )
}
