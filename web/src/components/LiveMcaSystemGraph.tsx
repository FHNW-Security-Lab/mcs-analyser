import { useEffect, useMemo, useState } from 'react'
import { Binary, Braces, Network, ShieldCheck, TriangleAlert } from 'lucide-react'
import { explainConstraint } from '../graph/mcaConstraints'
import { aggregateMcaTransitions, chooseBestTraceMessage, getMcaTrace } from '../graph/mcaTopology'
import { propagationStatus, scenarioIsEffective } from '../sim/engine'
import type { AircraftState, AttackScenario, McaArtifact, McaComponent, McaConstraint, Profile, PropagationStatus, SafetyLimits } from '../types'

interface LiveMcaSystemGraphProps {
  artifacts: Partial<Record<Profile, McaArtifact>>
  profile: Profile
  onProfileChange: (profile: Profile) => void
  state: AircraftState
  heightAglFt: number
  attacks: AttackScenario[]
  safety: SafetyLimits
}

type NodeState = 'inactive' | 'active' | 'attack' | 'blocked' | 'unsafe'
type GraphScope = 'live' | 'all'
type SafetyContribution = 'inactive' | 'nominal' | 'monitoring' | 'passes' | 'protects' | 'unsafe'

interface Point { x: number; y: number }

const WIDTH = 1100
const HEIGHT = 470
const NODE_W = 172
const NODE_H = 42
const columns = [105, 390, 680, 980]

const componentColumn = (component: McaComponent): number => {
  if (component.role === 'source') return 0
  if (['navigation_fusion', 'route_integrity', 'afdx_ingress_guard', 'radio_height_monitor'].includes(String(component.id))) return 1
  if (['flight_management', 'flight_guidance', 'envelope_protection'].includes(String(component.id))) return 2
  return 3
}

const statePriority: Record<NodeState, number> = { inactive: 0, active: 1, attack: 2, blocked: 3, unsafe: 4 }

const mergeState = (current: NodeState | undefined, next: NodeState): NodeState => (
  statePriority[next] > statePriority[current ?? 'inactive'] ? next : current ?? 'inactive'
)

const statusToNodeState = (status: PropagationStatus): NodeState => {
  if (status === 'unsafe') return 'unsafe'
  if (status === 'blocked' || status === 'recovered') return 'blocked'
  if (status === 'attempted' || status === 'propagated') return 'attack'
  return 'inactive'
}

const safetyContribution = (component: McaComponent | undefined, state: NodeState): SafetyContribution => {
  if (state === 'unsafe') return 'unsafe'
  if (state === 'blocked') return 'protects'
  if (state === 'attack') return 'passes'
  if (state === 'active') return component?.role === 'safeguard' ? 'monitoring' : 'nominal'
  return 'inactive'
}

const contributionLabel: Record<SafetyContribution, string> = {
  inactive: 'inactive',
  nominal: 'nominal path',
  monitoring: 'monitoring',
  passes: 'passes attack',
  protects: 'protects aircraft',
  unsafe: 'unsafe action',
}

const activeTypes = (state: AircraftState, heightAglFt: number, attacks: AttackScenario[], safety: SafetyLimits): string[] => {
  const envelopeViolated = Math.abs(state.rollDeg) > 32 || Math.abs(state.pitchDeg) > 18
  const routeViolated = Math.abs(state.crossTrackM / 1852) > safety.max_course_deviation_nm
  const effectiveTypes = attacks
    .filter((attack) => scenarioIsEffective(attack, state.time, state.flightPhase, heightAglFt))
    .flatMap((attack) => attack.evidence.message_types)
  return [...new Set([
    'MSG_AFDX_VL_NAV_SOLUTION',
    'MSG_AFDX_VL_AIR_DATA',
    'MSG_AFDX_VL_ATTITUDE',
    'MSG_AFDX_VL_FLIGHT_GUIDANCE',
    'MSG_AFDX_VL_ENVELOPE_COMMAND',
    envelopeViolated ? 'MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE' : 'MSG_AFDX_VL_AIRCRAFT_ATTITUDE_STATE',
    routeViolated ? 'MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE' : 'MSG_AFDX_VL_AIRCRAFT_POSITION_STATE',
    ...effectiveTypes,
  ])]
}

const positionsFor = (components: McaComponent[]): Map<string, Point> => {
  const grouped = [0, 1, 2, 3].map((column) => components.filter((component) => componentColumn(component) === column))
  const positions = new Map<string, Point>()
  grouped.forEach((items, column) => {
    items.forEach((component, index) => {
      const y = items.length === 1 ? HEIGHT / 2 : 34 + index * ((HEIGHT - 68) / (items.length - 1))
      positions.set(String(component.id), { x: columns[column], y })
    })
  })
  return positions
}

const label = (value: string) => value.replace(/^MSG_AFDX_(VL_|A429_|ASD_DLS_)?/, '').replaceAll('_', ' ')

export function LiveMcaSystemGraph({ artifacts, profile, onProfileChange, state, heightAglFt, attacks, safety }: LiveMcaSystemGraphProps) {
  const artifact = artifacts[profile]
  const components = artifact?.components ?? artifact?.nodes ?? []
  const componentNameById = useMemo(() => new Map(components.map((component) => [String(component.id), component.name])), [components])
  const transitions = useMemo(() => aggregateMcaTransitions(artifact?.communication_edges ?? artifact?.edges ?? []), [artifact])
  const messageTypes = useMemo(() => activeTypes(state, heightAglFt, attacks, safety), [state, heightAglFt, attacks, safety])
  const [selectedComponentId, setSelectedComponentId] = useState('navigation_fusion')
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null)
  const [scope, setScope] = useState<GraphScope>('live')

  const graphState = useMemo(() => {
    const nodeStates = new Map<string, NodeState>()
    const activePairs = new Map<string, NodeState>()
    const componentScenarioStates = new Map<string, NodeState>()
    if (!artifact) return { nodeStates, activePairs, componentScenarioStates }

    for (const type of messageTypes) {
      const candidates = (artifact.messages ?? []).filter((message) => message.type?.name === type).map((message) => message.id)
      const messageId = chooseBestTraceMessage(artifact, candidates)
      const trace = messageId === null ? null : getMcaTrace(artifact, messageId)
      trace?.nodeIds.forEach((id) => nodeStates.set(id, mergeState(nodeStates.get(id), 'active')))
      trace?.pairKeys.forEach((pair) => activePairs.set(pair, mergeState(activePairs.get(pair), 'active')))
    }

    for (const attack of attacks) {
      attack.steps.forEach((step, index) => {
        const status = propagationStatus(profile, attack, index, state.time, state.flightPhase, heightAglFt)
        const next = statusToNodeState(status)
        if (next === 'inactive' || !components.some((component) => String(component.id) === step.component)) return
        nodeStates.set(step.component, mergeState(nodeStates.get(step.component), next))
        const scenarioKey = `${step.component}|${attack.id}`
        componentScenarioStates.set(scenarioKey, mergeState(componentScenarioStates.get(scenarioKey), next))
        step.depends_on.forEach((dependencyId) => {
          const dependency = attack.steps.find((candidate) => candidate.id === dependencyId)
          if (!dependency || !components.some((component) => String(component.id) === dependency.component)) return
          activePairs.set(`${dependency.component}->${step.component}`, mergeState(activePairs.get(`${dependency.component}->${step.component}`), next))
        })
      })
    }
    return { nodeStates, activePairs, componentScenarioStates }
  }, [artifact, messageTypes, attacks, profile, state.time, state.flightPhase, heightAglFt, components])

  const positions = useMemo(() => positionsFor(components), [components])
  const selectedComponent = components.find((component) => String(component.id) === selectedComponentId) ?? components[0]
  const componentConstraints = useMemo(() => {
    if (!artifact || !selectedComponent) return []
    return (artifact.constraints ?? [])
      .filter((record) => String(record.producer_component_id) === String(selectedComponent.id))
      .sort((a, b) => {
        const score = (record: McaConstraint) => Number(messageTypes.includes(record.message_type_name ?? '')) * 2
          + Number(record.reachability === 'reachable_from_configured_sources')
        return score(b) - score(a)
      })
      .slice(0, 8)
  }, [artifact, selectedComponent, messageTypes])

  useEffect(() => {
    setSelectedMessageId(componentConstraints[0]?.message_id ?? null)
  }, [selectedComponentId, profile, componentConstraints[0]?.message_id])

  const selectedConstraint = componentConstraints.find((record) => record.message_id === selectedMessageId) ?? componentConstraints[0]
  const explanation = selectedConstraint ? explainConstraint(selectedConstraint, profile) : null
  const verified = artifact?.analysis?.completed_real_angr_run === true
  const activeCount = [...graphState.nodeStates.values()].filter((status) => status !== 'inactive').length
  const blockedCount = [...graphState.nodeStates.values()].filter((status) => status === 'blocked').length
  const passingCount = [...graphState.nodeStates.values()].filter((status) => status === 'attack').length
  const unsafeCount = [...graphState.nodeStates.values()].filter((status) => status === 'unsafe').length
  const selectedId = String(selectedComponent?.id ?? '')
  const selectedState = graphState.nodeStates.get(selectedId) ?? 'inactive'
  const selectedContribution = safetyContribution(selectedComponent, selectedState)
  const selectedScenarioOutcomes = attacks.flatMap((attack) => {
    const scenarioState = graphState.componentScenarioStates.get(`${selectedId}|${attack.id}`)
    if (!scenarioState) return []
    return [{ id: attack.id, title: attack.title, contribution: safetyContribution(selectedComponent, scenarioState) }]
  })
  const contextualPairs = useMemo(() => new Set(transitions
    .filter((transition) => transition.sourceId === selectedId || transition.targetId === selectedId)
    .map((transition) => `${transition.sourceId}->${transition.targetId}`)), [selectedId, transitions])

  return (
    <section className={`panel live-system-graph profile-${profile}`} aria-label="Live MCA component and constraint graph">
      <header className="live-system-header">
        <div><span className="eyebrow"><Network size={13} /> MCA / MCS runtime</span><h2>Active component graph</h2></div>
        <div className="live-system-scope" role="group" aria-label="Graph link visibility">
          <button className={scope === 'live' ? 'active' : ''} aria-pressed={scope === 'live'} onClick={() => setScope('live')}>Live paths</button>
          <button className={scope === 'all' ? 'active' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All links</button>
        </div>
        <div className="live-system-profile" role="tablist" aria-label="Component graph aircraft profile">
          {(['secure', 'vulnerable'] as const).map((item) => <button role="tab" aria-selected={profile === item} className={profile === item ? 'active' : ''} onClick={() => onProfileChange(item)} key={item}>{item}</button>)}
        </div>
        <div className="live-system-stats">
          <span className={verified ? 'verified' : ''}><Binary size={12} />{verified ? 'REAL ANGR' : 'LOADING'}</span>
          <span className={blockedCount ? 'protects' : ''}>{blockedCount} PROTECTING</span>
          <span className={passingCount ? 'passes' : ''}>{passingCount} PASSING</span>
          <span className={unsafeCount ? 'unsafe' : ''}>{unsafeCount} UNSAFE</span>
        </div>
      </header>

      <div className="live-system-body">
        <div className={`live-system-stage scope-${scope}`} role="img" aria-label={`${profile} MCA graph with ${activeCount} active components`}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            <defs><marker id={`live-arrow-${profile}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" /></marker></defs>
            {transitions.map((transition) => {
              const source = positions.get(transition.sourceId)
              const target = positions.get(transition.targetId)
              if (!source || !target) return null
              const pair = `${transition.sourceId}->${transition.targetId}`
              const status = graphState.activePairs.get(pair) ?? 'inactive'
              const contextual = contextualPairs.has(pair)
              const x1 = source.x + (target.x > source.x ? NODE_W / 2 : 0)
              const x2 = target.x - (target.x > source.x ? NODE_W / 2 : 0)
              const bend = Math.max(22, Math.abs(x2 - x1) * .42)
              const path = target.x > source.x
                ? `M ${x1} ${source.y} C ${x1 + bend} ${source.y}, ${x2 - bend} ${target.y}, ${x2} ${target.y}`
                : `M ${source.x} ${source.y + NODE_H / 2} C ${source.x + 42} ${source.y + 70}, ${target.x + 42} ${target.y - 70}, ${target.x} ${target.y - NODE_H / 2}`
              return (
                <path
                  className={`live-system-edge status-${status} ${contextual ? 'is-context' : ''} ${scope === 'live' && status === 'inactive' && !contextual ? 'is-hidden' : ''}`}
                  d={path}
                  markerEnd={`url(#live-arrow-${profile})`}
                  key={transition.id}
                ><title>{componentNameById.get(transition.sourceId) ?? transition.sourceId} → {componentNameById.get(transition.targetId) ?? transition.targetId}: {transition.channelNames.map(label).join(', ')}</title></path>
              )
            })}
            {[...graphState.activePairs.entries()].filter(([pair]) => !transitions.some((transition) => `${transition.sourceId}->${transition.targetId}` === pair)).map(([pair, status]) => {
              const [sourceId, targetId] = pair.split('->')
              const source = positions.get(sourceId); const target = positions.get(targetId)
              if (!source || !target) return null
              return <path className={`live-system-edge scenario status-${status}`} d={`M ${source.x + NODE_W / 2} ${source.y} C ${source.x + 120} ${source.y}, ${target.x - 120} ${target.y}, ${target.x - NODE_W / 2} ${target.y}`} markerEnd={`url(#live-arrow-${profile})`} key={`scenario-${pair}`} />
            })}
          </svg>
          {components.map((component) => {
            const point = positions.get(String(component.id))
            if (!point) return null
            const status = graphState.nodeStates.get(String(component.id)) ?? 'inactive'
            const contribution = safetyContribution(component, status)
            const isContext = transitions.some((transition) => (
              (transition.sourceId === selectedId && transition.targetId === String(component.id))
              || (transition.targetId === selectedId && transition.sourceId === String(component.id))
            ))
            return (
              <button
                type="button"
                className={`live-system-node role-${component.role ?? component.kind ?? 'component'} status-${status} ${selectedId === String(component.id) ? 'selected' : ''} ${isContext ? 'is-context' : ''} ${scope === 'live' && status === 'inactive' && !isContext && selectedId !== String(component.id) ? 'is-muted' : ''}`}
                style={{ left: `${((point.x - NODE_W / 2) / WIDTH) * 100}%`, top: `${((point.y - NODE_H / 2) / HEIGHT) * 100}%`, width: `${(NODE_W / WIDTH) * 100}%`, height: `${(NODE_H / HEIGHT) * 100}%` }}
                onClick={() => setSelectedComponentId(String(component.id))}
                aria-label={`${component.name}: ${contributionLabel[contribution]}`}
                key={component.id}
              >
                <i /><span>{component.name}</span><small>{contributionLabel[contribution]}</small>
              </button>
            )
          })}
          <div className="live-system-legend"><span><i className="active" />nominal</span><span><i className="monitoring" />monitoring</span><span><i className="attack" />passes attack</span><span><i className="blocked" />protects</span><span><i className="unsafe" />unsafe action</span></div>
        </div>

        <aside className="live-system-inspector" aria-label="Selected component constraints">
          {selectedComponent && (
            <>
              <div className="live-system-component-title">
                <span>{selectedComponent.role ?? selectedComponent.kind}</span><h3>{selectedComponent.name}</h3>
                <em className={`contribution-${selectedContribution}`}>{contributionLabel[selectedContribution]}</em>
              </div>
              <div className={`component-safety-contribution contribution-${selectedContribution}`}>
                {selectedContribution === 'unsafe' ? <TriangleAlert size={17} /> : selectedContribution === 'passes' || selectedContribution === 'nominal' ? <Network size={17} /> : <ShieldCheck size={17} />}
                <div><span>Safety contribution</span><strong>{contributionLabel[selectedContribution]}</strong></div>
                <div className="component-scenario-outcomes">
                  {selectedScenarioOutcomes.map((outcome) => <small className={`contribution-${outcome.contribution}`} key={outcome.id}><i />{outcome.title}</small>)}
                </div>
              </div>
              <div className="component-binary-line"><Binary size={12} /><code>{selectedComponent.binary?.filename ?? selectedComponent.id}</code></div>
              <div className="component-live-constraints">
                {componentConstraints.map((record) => (
                  <button type="button" className={`${record.message_id === selectedConstraint?.message_id ? 'selected' : ''} ${messageTypes.includes(record.message_type_name ?? '') ? 'active' : ''}`} onClick={() => setSelectedMessageId(record.message_id)} key={record.message_id}>
                    <span>{label(record.message_type_name ?? `MESSAGE ${record.message_id}`)}</span><b>{record.predicates?.length ?? 0}P</b>
                  </button>
                ))}
              </div>
              {selectedConstraint && explanation ? (
                <div className="selected-live-constraint">
                  <div><Braces size={13} /><strong>#{selectedConstraint.message_id}</strong><em>{selectedConstraint.reachability === 'reachable_from_configured_sources' ? 'REACHABLE' : 'DISCOVERY'}</em></div>
                  <code>{selectedConstraint.payload_expression ?? 'CONCRETE PAYLOAD'}</code>
                  {explanation.conditions.slice(0, 3).map((condition) => <span key={condition}><ShieldCheck size={10} />{condition}</span>)}
                  {(selectedConstraint.predicates ?? []).slice(0, 2).map((predicate, index) => <pre key={index}>{predicate.text}</pre>)}
                </div>
              ) : <div className="selected-live-constraint empty"><TriangleAlert size={16} /><span>NO ACTIVE SYMBOLIC RECORD</span></div>}
            </>
          )}
        </aside>
      </div>
    </section>
  )
}
