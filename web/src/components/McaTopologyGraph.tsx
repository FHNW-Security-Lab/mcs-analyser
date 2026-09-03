import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape, { type Core, type ElementDefinition, type EventObjectEdge, type EventObjectNode, type StylesheetJson } from 'cytoscape'
import { Download, Focus, GitBranch, LocateFixed, Network, Orbit, Search, ShieldCheck, TriangleAlert } from 'lucide-react'
import { propagationStatus } from '../sim/engine'
import type { AircraftState, AttackScenario, FlightPhase, McaArtifact, McaComponent, Profile } from '../types'
import { aggregateMcaTransitions, chooseBestTraceMessage, firstUnsafeWitness, getMcaTrace, type McaTransition } from '../graph/mcaTopology'
import {
  concreteMessageById,
  constraintRecordsForComponent,
  constraintRecordsForTrace,
  constraintRecordsForTransition,
} from '../graph/mcaConstraints'
import { McaConstraintEvidence } from './McaConstraintEvidence'
import { AircraftStateCard } from './AircraftStateCard'
import { StatusPill } from './StatusPill'

type GraphLayout = 'flow' | 'force'
type GraphSelection = { kind: 'node' | 'edge'; id: string } | null

interface ScenarioElement {
  id: string
  sourceId?: string
  targetId?: string
  stepIndex: number
  stepId: string
  sourceStepId?: string
  component: string
  label: string
  note: string
  kind: string
  atSeconds: number
  dependsOn: string[]
}

interface PhysicalElement {
  id: string
  label: string
  description: string
  relation: string
}

interface PhysicalTransition {
  id: string
  sourceId: string
  targetId: string
  label: string
  description: string
  feedback?: boolean
}

interface McaTopologyGraphProps {
  artifact: McaArtifact
  profile: Profile
  scenario: AttackScenario
  scenarioEnabled: boolean
  time: number
  flightPhase: FlightPhase
  heightAglFt: number
  aircraftState: AircraftState
}

const statusClasses = ['status-dormant', 'status-armed', 'status-attempted', 'status-propagated', 'status-blocked', 'status-recovered', 'status-unsafe']
const humanize = (value: string) => value.replace(/^MSG_AFDX_VL_/, '').replaceAll('_', ' ').toLowerCase()
const pairKey = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`
const boundTransitionForScenarioEdge = (edge: ScenarioElement, transitions: McaTransition[], scenario: AttackScenario) => transitions.find((candidate) => (
  candidate.sourceId === edge.sourceId
  && candidate.targetId === edge.targetId
  && candidate.channelNames.some((name) => scenario.evidence.message_types.includes(name))
))
const configuredStageGuard = (scenario: AttackScenario, stepIndex: number): string => {
  const step = scenario.steps[stepIndex]
  const terms = ['scenario armed', `time ≥ T+${step.at_seconds}s`]
  if (step.depends_on.length) terms.push(`dependencies complete: ${step.depends_on.join(', ')}`)
  if (step.kind === 'decision' || step.kind === 'effect') {
    if (scenario.effect.phase_gate?.length) terms.push(`phase ∈ {${scenario.effect.phase_gate.join(', ')}}`)
    if (scenario.effect.max_agl_ft != null) terms.push(`AGL ≤ ${scenario.effect.max_agl_ft} ft`)
  }
  return terms.join(' AND ')
}

const graphStyles: StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': '#10252b',
      'border-color': '#426570',
      'border-width': 1.5,
      'color': '#dce9e7',
      'font-family': 'Inter, ui-sans-serif, sans-serif',
      'font-size': 10,
      'font-weight': 600,
      'height': 48,
      'label': 'data(label)',
      'overlay-opacity': 0,
      'padding': '5px',
      'shape': 'round-rectangle',
      'text-halign': 'center',
      'text-max-width': '118px',
      'text-valign': 'center',
      'text-wrap': 'wrap',
      'transition-property': 'border-color, border-width, opacity, background-color',
      'transition-duration': 160,
      'width': 132,
    },
  },
  { selector: 'node.role-source', style: { 'background-color': '#102833', 'border-color': '#5689a3' } },
  { selector: 'node.role-processor', style: { 'background-color': '#132a2d', 'border-color': '#4b7776' } },
  { selector: 'node.role-safeguard', style: { 'background-color': '#102b27', 'border-color': '#4fd1b5' } },
  { selector: 'node.role-effect', style: { 'background-color': '#2b2419', 'border-color': '#d3a24f' } },
  { selector: 'node.role-sink', style: { 'background-color': '#1c2427', 'border-color': '#7f9498' } },
  {
    selector: 'node.plant-node',
    style: {
      'background-color': '#17232a',
      'border-color': '#70a6c8',
      'border-style': 'dashed',
      'height': 54,
      'width': 126,
    },
  },
  {
    selector: 'node.live-state-node',
    style: {
      'background-color': '#182a28',
      'border-color': '#dce9e7',
      'border-width': 3,
      'shape': 'ellipse',
      'height': 68,
      'width': 116,
    },
  },
  {
    selector: 'node.scenario-node',
    style: {
      'background-color': '#211b28',
      'border-color': '#9b738e',
      'border-style': 'dashed',
      'font-size': 8,
      'height': 43,
      'text-max-width': '98px',
      'width': 112,
    },
  },
  {
    selector: 'edge',
    style: {
      'arrow-scale': 0.8,
      'curve-style': 'bezier',
      'font-family': 'ui-monospace, monospace',
      'font-size': 7,
      'label': 'data(label)',
      'line-color': '#456773',
      'opacity': 0.86,
      'overlay-opacity': 0,
      'target-arrow-color': '#5b8792',
      'target-arrow-shape': 'triangle',
      'text-background-color': '#071318',
      'text-background-opacity': 0.88,
      'text-background-padding': '2px',
      'text-rotation': 'autorotate',
      'text-margin-y': -7,
      'transition-property': 'line-color, width, opacity',
      'transition-duration': 160,
      'width': 1.7,
    },
  },
  {
    selector: 'edge.discovery-only',
    style: {
      'line-color': '#a9874b',
      'line-style': 'dashed',
      'opacity': 0.58,
      'target-arrow-color': '#bd9956',
    },
  },
  {
    selector: 'edge.scenario-edge',
    style: {
      'curve-style': 'unbundled-bezier',
      'line-color': '#a76562',
      'line-style': 'dotted',
      'opacity': 0.68,
      'target-arrow-color': '#c97870',
      'width': 2.2,
    },
  },
  {
    selector: 'edge.plant-edge',
    style: {
      'line-color': '#70a6c8',
      'line-style': 'dashed',
      'opacity': 0.82,
      'target-arrow-color': '#70a6c8',
      'width': 2.4,
    },
  },
  {
    selector: 'edge.measurement-edge',
    style: {
      'line-color': '#66858d',
      'line-style': 'dotted',
      'opacity': 0.48,
      'target-arrow-color': '#66858d',
      'width': 1.6,
    },
  },
  {
    selector: 'edge.scenario-self-edge',
    style: {
      'curve-style': 'bezier',
      'loop-direction': '-45deg',
      'loop-sweep': '70deg',
    },
  },
  { selector: 'node.scenario-node.status-dormant', style: { 'opacity': 0.28 } },
  { selector: 'edge.scenario-edge.status-dormant', style: { 'opacity': 0.2 } },
  { selector: 'node.status-armed', style: { 'border-color': '#9b738e', 'border-style': 'dashed', 'border-width': 3, 'opacity': 0.88 } },
  { selector: 'edge.status-armed', style: { 'line-color': '#9b738e', 'line-style': 'dotted', 'target-arrow-color': '#9b738e', 'opacity': 0.8 } },
  { selector: 'node.status-attempted', style: { 'border-color': '#e3b564', 'border-width': 3 } },
  { selector: 'edge.status-attempted', style: { 'line-color': '#e3b564', 'target-arrow-color': '#e3b564', 'opacity': 1 } },
  { selector: 'node.status-propagated', style: { 'border-color': '#70a6c8', 'border-width': 3 } },
  { selector: 'edge.status-propagated', style: { 'line-color': '#70a6c8', 'target-arrow-color': '#70a6c8', 'opacity': 1 } },
  { selector: 'node.status-blocked', style: { 'background-color': '#302517', 'border-color': '#e3b564', 'border-width': 4 } },
  { selector: 'edge.status-blocked', style: { 'line-color': '#e3b564', 'target-arrow-color': '#e3b564', 'opacity': 1, 'width': 3 } },
  { selector: 'node.status-recovered', style: { 'background-color': '#102b27', 'border-color': '#4fd1b5', 'border-width': 4 } },
  { selector: 'edge.status-recovered', style: { 'line-color': '#4fd1b5', 'target-arrow-color': '#4fd1b5', 'opacity': 1, 'width': 3 } },
  { selector: 'node.status-unsafe', style: { 'background-color': '#351c1d', 'border-color': '#f07d63', 'border-width': 4 } },
  { selector: 'edge.status-unsafe', style: { 'line-color': '#f07d63', 'target-arrow-color': '#f07d63', 'opacity': 1, 'width': 3.2 } },
  { selector: '.is-dimmed', style: { 'opacity': 0.1, 'text-opacity': 0.12 } },
  { selector: 'node.is-focused', style: { 'border-color': '#e7efed', 'border-width': 4, 'opacity': 1 } },
  { selector: 'edge.is-focused', style: { 'line-color': '#dce9e7', 'target-arrow-color': '#dce9e7', 'opacity': 1, 'width': 3.5 } },
  { selector: 'node.lineage', style: { 'border-color': '#ff6375', 'border-width': 4, 'opacity': 1 } },
  { selector: 'edge.lineage', style: { 'line-color': '#ff6375', 'target-arrow-color': '#ff6375', 'line-style': 'solid', 'opacity': 1, 'width': 4 } },
  { selector: '.search-match', style: { 'border-color': '#68e0c6', 'border-width': 4, 'opacity': 1 } },
  { selector: ':selected', style: { 'overlay-color': '#e7efed', 'overlay-opacity': 0.08, 'overlay-padding': 5 } },
]

function buildGraphElements(
  artifact: McaArtifact,
  scenario: AttackScenario,
  transitions: McaTransition[],
): {
  elements: ElementDefinition[]
  scenarioNodes: ScenarioElement[]
  scenarioEdges: ScenarioElement[]
  scenarioNodeIds: string[]
  physicalNodes: PhysicalElement[]
  physicalEdges: PhysicalTransition[]
} {
  const components = artifact.components ?? artifact.nodes ?? []
  const componentIds = new Set(components.map((component) => String(component.id)))
  const elements: ElementDefinition[] = components.map((component) => ({
    data: {
      id: String(component.id),
      label: component.name,
      role: component.role ?? component.kind ?? 'component',
      kind: 'component',
    },
    classes: `mca-node role-${component.role ?? component.kind ?? 'component'}`,
  }))

  for (const transition of transitions) {
    const channelCount = transition.channelNames.length
    elements.push({
      data: {
        id: transition.id,
        source: transition.sourceId,
        target: transition.targetId,
        pairKey: pairKey(transition.sourceId, transition.targetId),
        label: channelCount === 1 ? humanize(transition.channelNames[0]) : `${channelCount} virtual links`,
        kind: 'mca-transition',
      },
      classes: `mca-edge ${transition.reachability === 'discovery_only' ? 'discovery-only' : 'reachable-edge'}`,
    })
  }

  const physicalNodes: PhysicalElement[] = [
    {
      id: 'plant:autothrust',
      label: 'Autothrust / FADEC',
      description: 'Converts the FMS speed and thrust target into a bounded engine command.',
      relation: 'Configured controller; its software is outside the currently analyzed binaries.',
    },
    {
      id: 'plant:ailerons',
      label: 'Ailerons',
      description: 'Left and right aileron deflection produces the commanded roll moment.',
      relation: 'Configured bounded control-surface response; outside the analyzed binaries.',
    },
    {
      id: 'plant:elevator',
      label: 'Elevator',
      description: 'Elevator deflection produces the commanded pitch moment.',
      relation: 'Configured bounded control-surface response; outside the analyzed binaries.',
    },
    {
      id: 'plant:rudder',
      label: 'Rudder',
      description: 'Rudder deflection produces the commanded yaw moment.',
      relation: 'Configured bounded control-surface response; outside the analyzed binaries.',
    },
    {
      id: 'plant:engines',
      label: 'Engines / thrust',
      description: 'The engines accept the FADEC command and provide bounded thrust to the aircraft dynamics model.',
      relation: 'Configured propulsion relation; engine-control software is outside the analyzed binaries.',
    },
    {
      id: 'plant:rigid-body',
      label: 'Aircraft rigid-body plant',
      description: 'The bounded simulation plant integrates forces and moments into attitude, altitude, and course.',
      relation: 'Discrete-time flight-dynamics assumption; not an MCA message transition.',
    },
    {
      id: 'plant:live-state',
      label: 'ALB physical state',
      description: 'Current simulated aircraft roll, pitch, yaw, altitude, and geographic course.',
      relation: 'Live simulator telemetry used for visualization and safety predicates.',
    },
  ]
  for (const physical of physicalNodes) {
    elements.push({
      data: { id: physical.id, label: physical.label, role: 'physical', kind: 'plant' },
      classes: `plant-node ${physical.id === 'plant:live-state' ? 'live-state-node' : ''}`,
    })
  }
  const plantSourceId = componentIds.has('actuator_control')
    ? 'actuator_control'
    : componentIds.has('aircraft_effect')
      ? 'aircraft_effect'
      : components.at(-1)?.id != null
        ? String(components.at(-1)?.id)
        : null
  const physicalEdges: PhysicalTransition[] = plantSourceId
    ? [
        { id: 'plant-edge:aileron-command', sourceId: plantSourceId, targetId: 'plant:ailerons', label: 'roll command', description: 'Maps the bounded roll actuator word to aileron deflection.' },
        { id: 'plant-edge:elevator-command', sourceId: plantSourceId, targetId: 'plant:elevator', label: 'pitch command', description: 'Maps the bounded pitch actuator word to elevator deflection.' },
        { id: 'plant-edge:rudder-command', sourceId: plantSourceId, targetId: 'plant:rudder', label: 'yaw command', description: 'Maps the bounded yaw actuator word to rudder deflection.' },
        { id: 'plant-edge:aileron-feedback', sourceId: 'plant:ailerons', targetId: plantSourceId, label: 'surface position', description: 'Returns measured aileron position to actuator monitoring.', feedback: true },
        { id: 'plant-edge:elevator-feedback', sourceId: 'plant:elevator', targetId: plantSourceId, label: 'surface position', description: 'Returns measured elevator position to actuator monitoring.', feedback: true },
        { id: 'plant-edge:rudder-feedback', sourceId: 'plant:rudder', targetId: plantSourceId, label: 'surface position', description: 'Returns measured rudder position to actuator monitoring.', feedback: true },
        { id: 'plant-edge:aileron-moment', sourceId: 'plant:ailerons', targetId: 'plant:rigid-body', label: 'roll moment', description: 'Applies the bounded aileron roll moment to the rigid-body plant.' },
        { id: 'plant-edge:elevator-moment', sourceId: 'plant:elevator', targetId: 'plant:rigid-body', label: 'pitch moment', description: 'Applies the bounded elevator pitch moment to the rigid-body plant.' },
        { id: 'plant-edge:rudder-moment', sourceId: 'plant:rudder', targetId: 'plant:rigid-body', label: 'yaw moment', description: 'Applies the bounded rudder yaw moment to the rigid-body plant.' },
        ...(componentIds.has('flight_management') ? [
          { id: 'plant-edge:thrust-target', sourceId: 'flight_management', targetId: 'plant:autothrust', label: 'speed / thrust target', description: 'Supplies the selected speed and thrust mode to the configured autothrust controller.' },
        ] : []),
        { id: 'plant-edge:engine-command', sourceId: 'plant:autothrust', targetId: 'plant:engines', label: 'fuel / thrust command', description: 'The FADEC converts the target into bounded engine actuation.' },
        { id: 'plant-edge:engine-feedback', sourceId: 'plant:engines', targetId: 'plant:autothrust', label: 'N1 / EGT feedback', description: 'Engine speed and temperature sensors close the propulsion-control loop.', feedback: true },
        { id: 'plant-edge:thrust', sourceId: 'plant:engines', targetId: 'plant:rigid-body', label: 'bounded thrust', description: 'Applies bounded engine thrust to the aircraft dynamics model.' },
        { id: 'plant-edge:state', sourceId: 'plant:rigid-body', targetId: 'plant:live-state', label: 'integrated state', description: 'Advances the discrete coordinated-turn state used by the simulation and safety predicates.' },
        ...([
          ['gnss_receiver', 'position / velocity', 'GNSS receiver observes the resulting position and groundspeed.'],
          ['inertial_reference', 'specific force / body rates', 'IRS sensors observe accelerations and angular rates.'],
          ['radio_navigation', 'navaid geometry', 'Radio navigation observes aircraft geometry relative to configured navaids.'],
          ['air_data', 'pressure / airspeed', 'Air-data sensors observe pressure altitude and airspeed.'],
          ['attitude_reference', 'attitude / body rates', 'Attitude sensors observe the resulting orientation and rates.'],
          ['radio_altimeter_1', 'radio height channel 1', 'The first radio altimeter observes height above terrain.'],
          ['radio_altimeter_2', 'radio height channel 2', 'The independent second channel observes height above terrain.'],
        ] as const).filter(([targetId]) => componentIds.has(targetId)).map(([targetId, label, description]) => ({
          id: `plant-edge:measurement:${targetId}`,
          sourceId: 'plant:live-state',
          targetId,
          label,
          description,
          feedback: true,
        })),
      ]
    : []
  physicalEdges.forEach((edge) => elements.push({
    data: { id: edge.id, source: edge.sourceId, target: edge.targetId, label: edge.label, kind: 'plant-edge' },
    classes: `plant-edge ${edge.feedback ? 'measurement-edge' : ''}`,
  }))

  const scenarioNodes: ScenarioElement[] = []
  const claimedNativeStages = new Set<string>()
  const scenarioNodeIds = scenario.steps.map((step, stepIndex) => {
    // One Cytoscape node cannot represent two ordered stages inside the same
    // component: that would create an invalid zero-length self edge. Bind the
    // first stage to the real component and render later stages as explicit
    // dashed scenario-stage nodes while retaining their component evidence.
    if (componentIds.has(step.component) && !claimedNativeStages.has(step.component)) {
      claimedNativeStages.add(step.component)
      return step.component
    }
    const id = `scenario:${scenario.id}:${stepIndex}`
    scenarioNodes.push({
      id,
      stepIndex,
      stepId: step.id,
      component: step.component,
      label: step.label,
      note: step.note,
      kind: step.kind,
      atSeconds: step.at_seconds,
      dependsOn: step.depends_on,
    })
    elements.push({
      data: {
        id,
        label: componentIds.has(step.component) ? `${humanize(step.component)} · ${step.label}` : humanize(step.component),
        role: componentIds.has(step.component) ? 'scenario-stage' : 'external',
        kind: 'scenario-node',
        stepIndex,
      },
      classes: 'scenario-node status-dormant',
    })
    return id
  })

  const scenarioEdges: ScenarioElement[] = []
  const stepIndexById = new Map(scenario.steps.map((step, index) => [step.id, index]))
  scenario.steps.forEach((targetStep, targetIndex) => {
    // Explicit dependency arrays are the scenario DAG. The fallback only
    // supports legacy artifacts which predate depends_on.
    const dependencyIds = targetStep.depends_on ?? (targetIndex > 0 ? [scenario.steps[targetIndex - 1].id] : [])
    dependencyIds.forEach((sourceStepId) => {
      const sourceIndex = stepIndexById.get(sourceStepId)
      if (sourceIndex === undefined) return
      const edge: ScenarioElement = {
        id: `scenario-edge:${scenario.id}:${sourceStepId}:${targetStep.id}`,
        sourceId: scenarioNodeIds[sourceIndex],
        targetId: scenarioNodeIds[targetIndex],
        stepIndex: targetIndex,
        stepId: targetStep.id,
        sourceStepId,
        component: targetStep.component,
        label: targetStep.label,
        note: targetStep.note,
        kind: targetStep.kind,
        atSeconds: targetStep.at_seconds,
        dependsOn: dependencyIds,
      }
      scenarioEdges.push(edge)
      elements.push({
        data: {
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          label: 'configured dependency',
          kind: 'scenario-edge',
          stepIndex: edge.stepIndex,
        },
        classes: `scenario-edge ${edge.sourceId === edge.targetId ? 'scenario-self-edge ' : ''}status-dormant`,
      })
    })
  })

  return { elements, scenarioNodes, scenarioEdges, scenarioNodeIds, physicalNodes, physicalEdges }
}

function runLayout(cy: Core, layout: GraphLayout) {
  if (layout === 'flow') {
    const sources = cy.nodes('.mca-node.role-source').map((node) => node.id())
    const scenarioNodes = cy.nodes('.scenario-node').map((node) => node.id())
    const knownPositions = new Map<string, { x: number; y: number }>([
      ['navigation_fusion', { x: 355, y: 100 }],
      ['route_integrity', { x: 355, y: 205 }],
      ['afdx_ingress_guard', { x: 355, y: 310 }],
      ['radio_height_monitor', { x: 355, y: 415 }],
      ['flight_management', { x: 605, y: 135 }],
      ['flight_guidance', { x: 605, y: 260 }],
      ['envelope_protection', { x: 605, y: 385 }],
      ['actuator_control', { x: 790, y: 205 }],
      ['aircraft_effect', { x: 1045, y: 500 }],
      ['primary_display', { x: 1185, y: 500 }],
      ['plant:autothrust', { x: 790, y: 430 }],
      ['plant:ailerons', { x: 920, y: 105 }],
      ['plant:elevator', { x: 920, y: 185 }],
      ['plant:rudder', { x: 920, y: 265 }],
      ['plant:engines', { x: 920, y: 430 }],
      ['plant:rigid-body', { x: 1045, y: 280 }],
      ['plant:live-state', { x: 1185, y: 280 }],
    ])
    cy.nodes().positions((node) => {
      const known = knownPositions.get(node.id())
      if (known) return known
      const sourceIndex = sources.indexOf(node.id())
      if (sourceIndex >= 0) {
        const y = sources.length === 1 ? 280 : 78 + sourceIndex * (390 / Math.max(1, sources.length - 1))
        return { x: 105, y }
      }
      const scenarioIndex = scenarioNodes.indexOf(node.id())
      if (scenarioIndex >= 0) return { x: 250 + scenarioIndex * 155, y: 48 }
      return { x: 600, y: 470 }
    })
    cy.fit(undefined, 42)
  } else {
    cy.layout({
      name: 'cose' as const,
      animate: false,
      componentSpacing: 80,
      fit: true,
      gravity: 0.45,
      idealEdgeLength: 125,
      nodeRepulsion: 9000,
      numIter: 700,
      padding: 38,
      randomize: true,
    }).run()
  }
  if (cy.width() < 520 && cy.zoom() < 0.62) {
    cy.zoom(0.62)
    cy.center()
  }
}

function ComponentDetails({ component }: { component: McaComponent }) {
  return (
    <>
      <div className="inspector-title-row">
        <div><span>Analyzed native component</span><h3>{component.name}</h3></div>
        <StatusPill tone={component.role === 'safeguard' ? 'recovered' : 'propagated'}>{component.role ?? component.kind ?? 'component'}</StatusPill>
      </div>
      <p className="inspector-copy">{component.description ?? 'Component-local behavior recovered from the compiled avionics binary.'}</p>
      <dl className="inspector-facts">
        <div><dt>Binary</dt><dd>{component.binary?.filename ?? component.binary?.path ?? 'not recorded'}</dd></div>
        <div><dt>Architecture</dt><dd>{component.binary?.architecture ?? 'x86-64'}</dd></div>
        <div><dt>Consumes</dt><dd>{component.consumes?.length ?? 0} virtual links</dd></div>
        <div><dt>Produces</dt><dd>{component.produces?.length ?? 0} virtual links</dd></div>
      </dl>
      <div className="inspector-hash"><span>SHA-256</span><code>{component.binary?.sha256 ?? 'not recorded'}</code></div>
      <div className="channel-chip-list">
        {[...(component.consumes ?? []), ...(component.produces ?? [])].map((channel, index) => (
          <span key={`${channel.id}-${index}`}>{humanize(channel.name ?? channel.hex)}</span>
        ))}
      </div>
    </>
  )
}

function TransitionDetails({ transition }: { transition: McaTransition }) {
  return (
    <>
      <div className="inspector-title-row">
        <div><span>angr-derived transition</span><h3>{transition.sourceId.replaceAll('_', ' ')} → {transition.targetId.replaceAll('_', ' ')}</h3></div>
        <StatusPill tone={transition.reachability === 'reachable' ? 'propagated' : 'warning'}>{transition.reachability.replaceAll('_', ' ')}</StatusPill>
      </div>
      <p className="inspector-copy">The MCA fixed point contains {transition.instanceCount} symbolic message instances across this component boundary.</p>
      <dl className="inspector-facts">
        <div><dt>Virtual links</dt><dd>{transition.channelNames.length}</dd></div>
        <div><dt>Reachable</dt><dd>{transition.reachableMessageIds.length} messages</dd></div>
        <div><dt>Discovery only</dt><dd>{transition.discoveryMessageIds.length} messages</dd></div>
        <div><dt>Predicates</dt><dd>{transition.constraintCount}</dd></div>
      </dl>
      <div className="transition-channel-list">
        {transition.channelNames.map((name) => <span key={name}>{humanize(name)}</span>)}
      </div>
      <div className="message-id-line"><span>Message instances</span><code>{transition.messageIds.slice(0, 16).join(', ')}{transition.messageIds.length > 16 ? ' …' : ''}</code></div>
    </>
  )
}

function PhysicalDetails({ element }: { element: PhysicalElement }) {
  return (
    <>
      <div className="inspector-title-row">
        <div><span>Configured physical layer</span><h3>{element.label}</h3></div>
        <StatusPill tone="warning">plant assumption</StatusPill>
      </div>
      <p className="inspector-copy">{element.description}</p>
      <div className="scenario-provenance-note">{element.relation} angr establishes discrete binary message feasibility; it does not solve these continuous dynamics.</div>
    </>
  )
}

function PhysicalTransitionDetails({ edge }: { edge: PhysicalTransition }) {
  return (
    <>
      <div className="inspector-title-row">
        <div><span>Configured plant relation</span><h3>{edge.label}</h3></div>
        <StatusPill tone="warning">not MCA-derived</StatusPill>
      </div>
      <p className="inspector-copy">{edge.description}</p>
      <div className="scenario-provenance-note">This dashed edge is constrained by the bounded simulation plant. It is intentionally separated from the solid native component/message transitions recovered by angr.</div>
    </>
  )
}

const coverageLabel: Record<AttackScenario['evidence']['coverage'], string> = {
  native: 'Native MCA coverage',
  partial: 'Partial MCA coverage',
  configured: 'Configured overlay only',
  plant: 'Plant model only',
}

function ScenarioEvidenceDetails({
  scenario,
  componentById,
  transitions,
  selectedEdge,
}: {
  scenario: AttackScenario
  componentById: Map<string, McaComponent>
  transitions: McaTransition[]
  selectedEdge?: ScenarioElement
}) {
  const componentBindings = scenario.evidence.native_components.map((id) => ({ id, component: componentById.get(id) }))
  const messageBindings = scenario.evidence.message_types.map((name) => ({
    name,
    transitions: transitions.filter((transition) => transition.channelNames.includes(name)),
  }))
  const componentPair = selectedEdge
    ? transitions.find((transition) => transition.sourceId === selectedEdge.sourceId && transition.targetId === selectedEdge.targetId)
    : undefined
  const exactBinding = selectedEdge ? boundTransitionForScenarioEdge(selectedEdge, transitions, scenario) : undefined

  return (
    <section className={`scenario-mca-evidence coverage-${scenario.evidence.coverage}`} aria-label={`${scenario.title} MCA evidence coverage`}>
      <div className="scenario-mca-heading">
        <span>Scenario ↔ native evidence</span>
        <i className={`coverage-badge coverage-${scenario.evidence.coverage}`}>{coverageLabel[scenario.evidence.coverage]}</i>
      </div>
      <p>{scenario.evidence.note}</p>
      {selectedEdge && (
        <div className={`exact-pair-binding ${exactBinding ? 'present' : 'absent'}`}>
          <strong>{exactBinding
            ? 'Exact component pair + declared message binding found'
            : componentPair
              ? 'Component pair exists, but no declared message binds this edge'
              : 'No native transition for this exact DAG edge'}</strong>
          <span>{selectedEdge.sourceStepId} → {selectedEdge.stepId}{exactBinding ? ` · ${exactBinding.instanceCount} symbolic instances` : ' · configured causal dependency'}</span>
        </div>
      )}
      <div className="evidence-binding-group">
        <span>Declared native components</span>
        {componentBindings.length === 0
          ? <p>No native component claim for this scenario.</p>
          : componentBindings.map(({ id, component }) => (
              <div className={`evidence-binding ${component ? 'present' : 'absent'}`} key={id}>
                <code>{id}</code><span>{component ? `${component.name} · analyzed binary present` : 'not present in this artifact'}</span>
              </div>
            ))}
      </div>
      <div className="evidence-binding-group">
        <span>Exact native message bindings</span>
        {messageBindings.length === 0
          ? <p>No MCA message type is claimed; the scenario remains outside native message evidence.</p>
          : messageBindings.map(({ name, transitions: matches }) => (
              <div className={`evidence-binding ${matches.length ? 'present' : 'absent'}`} key={name}>
                <code>{name}</code>
                <span>{matches.length
                  ? matches.map((match) => `${match.sourceId} → ${match.targetId} (${match.instanceCount})`).join(' · ')
                  : 'declared binding not emitted by this artifact'}</span>
              </div>
            ))}
      </div>
    </section>
  )
}

export function McaTopologyGraph({ artifact, profile, scenario, scenarioEnabled, time, flightPhase, heightAglFt, aircraftState }: McaTopologyGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inspectorRef = useRef<HTMLElement | null>(null)
  const cyRef = useRef<Core | null>(null)
  const [layout, setLayout] = useState<GraphLayout>('flow')
  const [selection, setSelection] = useState<GraphSelection>(null)
  const [search, setSearch] = useState('')
  const [traceMessageId, setTraceMessageId] = useState<number | null>(null)

  const components = artifact.components ?? artifact.nodes ?? []
  const componentById = useMemo(() => new Map(components.map((component) => [String(component.id), component])), [components])
  const transitions = useMemo(() => aggregateMcaTransitions(artifact.communication_edges ?? artifact.edges ?? []), [artifact])
  const transitionById = useMemo(() => new Map(transitions.map((transition) => [transition.id, transition])), [transitions])
  const graph = useMemo(() => buildGraphElements(artifact, scenario, transitions), [artifact, scenario, transitions])
  const unsafeWitness = useMemo(() => firstUnsafeWitness(artifact), [artifact])
  const trace = useMemo(() => traceMessageId === null ? null : getMcaTrace(artifact, traceMessageId), [artifact, traceMessageId])
  const runtimeStatuses = scenario.steps.map((_, index) => (
    scenarioEnabled ? propagationStatus(profile, scenario, index, time, flightPhase, heightAglFt) : 'dormant'
  ))

  useEffect(() => {
    if (!containerRef.current) return
    const cy = cytoscape({
      container: containerRef.current,
      elements: graph.elements,
      style: graphStyles,
      minZoom: 0.28,
      maxZoom: 2.4,
      boxSelectionEnabled: false,
    })
    cyRef.current = cy
    runLayout(cy, layout)

    cy.on('tap', 'node', (event: EventObjectNode) => {
      setSelection({ kind: 'node', id: event.target.id() })
      setTraceMessageId(null)
    })
    cy.on('tap', 'edge', (event: EventObjectEdge) => {
      const id = event.target.id()
      setSelection({ kind: 'edge', id })
      const transition = transitionById.get(id)
      const scenarioEdge = graph.scenarioEdges.find((edge) => edge.id === id)
      const relatedTransition = scenarioEdge
        ? boundTransitionForScenarioEdge(scenarioEdge, transitions, scenario)
        : undefined
      const evidenceTransition = transition ?? relatedTransition
      setTraceMessageId(evidenceTransition ? chooseBestTraceMessage(artifact, evidenceTransition.messageIds) : null)
    })
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelection(null)
        setTraceMessageId(null)
      }
    })

    let resizeFrame = 0
    let lastWidth = containerRef.current.clientWidth
    let lastHeight = containerRef.current.clientHeight
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight
      cy.resize()
      if (Math.abs(width - lastWidth) > 8 || Math.abs(height - lastHeight) > 8) {
        cancelAnimationFrame(resizeFrame)
        resizeFrame = requestAnimationFrame(() => cy.fit(undefined, 38))
        lastWidth = width
        lastHeight = height
      }
    })
    resizeObserver.observe(containerRef.current)
    return () => {
      cancelAnimationFrame(resizeFrame)
      resizeObserver.disconnect()
      cy.destroy()
      cyRef.current = null
    }
    // Layout changes are applied without rebuilding the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact, graph, transitionById])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements('.scenario-node, .scenario-edge, .trace-node').removeClass(statusClasses.join(' '))
    cy.nodes('.trace-node').removeClass('trace-node')
    graph.scenarioNodeIds.forEach((id, index) => {
      cy.$id(id).addClass(`trace-node status-${runtimeStatuses[index]}`)
    })
    graph.scenarioEdges.forEach((edge) => {
      cy.$id(edge.id).addClass(`status-${runtimeStatuses[edge.stepIndex]}`)
    })
  }, [graph, runtimeStatuses])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass('is-dimmed is-focused lineage search-match')
    let context = cy.collection()

    if (trace) {
      const traceNodes = cy.nodes().filter((node) => trace.nodeIds.includes(node.id()))
      const traceEdges = cy.edges('.mca-edge').filter((edge) => trace.pairKeys.includes(String(edge.data('pairKey'))))
      traceNodes.addClass('lineage')
      traceEdges.addClass('lineage')
      context = context.union(traceNodes).union(traceEdges)
    }

    if (selection) {
      const selected = cy.$id(selection.id)
      selected.addClass('is-focused')
      const neighborhood = selection.kind === 'node'
        ? selected.union(selected.predecessors()).union(selected.successors())
        : selected.union(selected.source()).union(selected.target()).union(selected.source().predecessors()).union(selected.target().successors())
      context = context.union(neighborhood)
    }

    const query = search.trim().toLowerCase()
    if (query) {
      const matchingNodes = cy.nodes().filter((node) => [node.id(), node.data('label'), node.data('role')].some((value) => String(value ?? '').toLowerCase().includes(query)))
      const matchingEdges = cy.edges().filter((edge) => [edge.data('label'), edge.source().data('label'), edge.target().data('label')].some((value) => String(value ?? '').toLowerCase().includes(query)))
      matchingNodes.addClass('search-match')
      matchingEdges.addClass('search-match')
      context = context.union(matchingNodes).union(matchingEdges).union(matchingEdges.connectedNodes())
    }

    if (context.length > 0) cy.elements().not(context).addClass('is-dimmed')
  }, [search, selection, trace])

  useEffect(() => {
    if (inspectorRef.current) inspectorRef.current.scrollTop = 0
  }, [selection, traceMessageId])

  useEffect(() => {
    if (selection?.kind !== 'edge') return
    const transition = transitionById.get(selection.id)
    const scenarioEdge = graph.scenarioEdges.find((edge) => edge.id === selection.id)
    const relatedTransition = scenarioEdge
      ? boundTransitionForScenarioEdge(scenarioEdge, transitions, scenario)
      : undefined
    const evidenceTransition = transition ?? relatedTransition
    setTraceMessageId(evidenceTransition ? chooseBestTraceMessage(artifact, evidenceTransition.messageIds) : null)
  }, [artifact, graph.scenarioEdges, selection, transitionById, transitions])

  const applyLayout = (next: GraphLayout) => {
    setLayout(next)
    if (cyRef.current) runLayout(cyRef.current, next)
  }

  const showUnsafeWitness = () => {
    if (unsafeWitness === null) return
    setSelection(null)
    setTraceMessageId(unsafeWitness)
  }

  const exportGraph = () => {
    const cy = cyRef.current
    if (!cy) return
    const anchor = document.createElement('a')
    anchor.download = `albatros-${profile}-mca-topology.png`
    anchor.href = cy.png({ full: true, bg: '#071318', scale: 2 })
    anchor.click()
  }

  const selectedComponent = selection?.kind === 'node' ? componentById.get(selection.id) : undefined
  const selectedTransition = selection?.kind === 'edge' ? transitionById.get(selection.id) : undefined
  const selectedScenarioNode = selection?.kind === 'node' ? graph.scenarioNodes.find((node) => node.id === selection.id) : undefined
  const selectedPhysicalNode = selection?.kind === 'node' ? graph.physicalNodes.find((node) => node.id === selection.id) : undefined
  const selectedPhysicalEdge = selection?.kind === 'edge' ? graph.physicalEdges.find((edge) => edge.id === selection.id) : undefined
  const selectedScenarioEdge = selection?.kind === 'edge' ? graph.scenarioEdges.find((edge) => edge.id === selection.id) : undefined
  const selectedScenarioStep = selectedScenarioEdge ? scenario.steps[selectedScenarioEdge.stepIndex] : undefined
  const relatedScenarioTransition = selectedScenarioEdge
    ? boundTransitionForScenarioEdge(selectedScenarioEdge, transitions, scenario)
    : undefined

  let constraintRecords = selectedTransition
    ? constraintRecordsForTransition(artifact, selectedTransition)
    : selectedComponent
      ? constraintRecordsForComponent(artifact, String(selectedComponent.id))
      : selectedScenarioEdge && relatedScenarioTransition
        ? constraintRecordsForTransition(artifact, relatedScenarioTransition)
        : trace
          ? constraintRecordsForTrace(artifact, trace.entries)
          : []
  let constraintScope = selectedTransition
    ? 'Selected MCA transition'
    : selectedComponent
      ? 'Messages produced by this component'
      : selectedScenarioEdge
        ? 'Parallel analyzed transition'
        : trace
          ? 'Selected witness chain'
          : 'Current selection'
  if (trace && !selection) {
    constraintRecords = constraintRecordsForTrace(artifact, trace.entries).reverse()
    constraintScope = 'Selected witness chain'
  }

  const elementLabel = (id: string) => componentById.get(id)?.name
    ?? humanize(graph.scenarioNodes.find((node) => node.id === id)?.component ?? id)
  const concreteTraceMessage = trace ? concreteMessageById(artifact, trace.messageId) : null

  return (
    <div className="topology-view" data-testid="mca-topology-view">
      <div className="topology-toolbar">
        <label className="graph-search">
          <Search size={14} />
          <span className="sr-only">Search components or virtual links</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search component or link…" />
        </label>
        <div className="graph-tool-group" aria-label="Graph layout">
          <button className={layout === 'flow' ? 'active' : ''} onClick={() => applyLayout('flow')} aria-pressed={layout === 'flow'}><GitBranch size={14} /> Signal flow</button>
          <button className={layout === 'force' ? 'active' : ''} onClick={() => applyLayout('force')} aria-pressed={layout === 'force'}><Orbit size={14} /> Force</button>
        </div>
        <div className="graph-tool-group compact">
          <button onClick={() => cyRef.current?.fit(undefined, 40)} title="Fit graph to canvas"><Focus size={14} /> Fit</button>
          <button onClick={exportGraph} title="Export graph as PNG"><Download size={14} /> Export</button>
        </div>
        <button className={`witness-button ${unsafeWitness === null ? 'safe' : 'unsafe'}`} disabled={unsafeWitness === null} onClick={showUnsafeWitness}>
          {unsafeWitness === null ? <ShieldCheck size={15} /> : <TriangleAlert size={15} />}
          {unsafeWitness === null ? 'No unsafe MCA witness' : `Trace unsafe witness #${unsafeWitness}`}
        </button>
      </div>

      <div className="topology-shell">
        <div className="topology-stage">
          <div className="aircraft-boundary-label"><LocateFixed size={13} /><span>Aircraft avionics + physical boundary</span><small>solid: angr / MCA · dashed blue: commands/plant · dotted gray: measurements</small></div>
          <div ref={containerRef} className="topology-canvas" role="img" aria-label={`${profile} aircraft graph with ${components.length} analyzed components, ${transitions.length} native transitions, and an explicit physical plant`} />
          <div className="topology-legend" aria-label="Graph legend">
            <span><i className="legend-source" /> sensor / source</span>
            <span><i className="legend-processor" /> processor</span>
            <span><i className="legend-safeguard" /> safeguard</span>
            <span><i className="legend-reachable" /> MCA reachable</span>
            <span><i className="legend-discovery" /> discovery only</span>
            <span><i className="legend-scenario" /> runtime scenario</span>
            <span><i style={{ width: 15, height: 0, border: 0, borderTop: '2px dashed #70a6c8', borderRadius: 0, background: 'none' }} /> plant assumption</span>
            <span><i className="legend-feedback" /> sensor feedback</span>
            <span><i className="legend-lineage" /> selected lineage</span>
          </div>
        </div>

        <aside ref={inspectorRef} className="topology-inspector">
          <AircraftStateCard profile={profile} state={aircraftState} />
          {selectedComponent && <ComponentDetails component={selectedComponent} />}
          {selectedTransition && <TransitionDetails transition={selectedTransition} />}
          {selectedPhysicalNode && <PhysicalDetails element={selectedPhysicalNode} />}
          {selectedPhysicalEdge && <PhysicalTransitionDetails edge={selectedPhysicalEdge} />}
          {selectedScenarioNode && (
            <>
              <div className="inspector-title-row"><div><span>Configured boundary event</span><h3>{humanize(selectedScenarioNode.component)}</h3></div><StatusPill tone={runtimeStatuses[selectedScenarioNode.stepIndex]}>{runtimeStatuses[selectedScenarioNode.stepIndex]}</StatusPill></div>
              <p className="inspector-copy"><strong>{selectedScenarioNode.label}.</strong> {selectedScenarioNode.note}</p>
              <div className="scenario-provenance-note">This node comes from the configured scenario, not from an analyzed aircraft binary.</div>
              <dl className="inspector-facts">
                <div><dt>Activation</dt><dd>T+{selectedScenarioNode.atSeconds}s</dd></div><div><dt>Type</dt><dd>{selectedScenarioNode.kind}</dd></div>
                <div><dt>Dependencies</dt><dd>{selectedScenarioNode.dependsOn.join(', ') || 'root stage'}</dd></div><div><dt>Current flight inputs</dt><dd>{flightPhase} · {Math.round(heightAglFt)} ft AGL</dd></div>
              </dl>
              <ScenarioEvidenceDetails scenario={scenario} componentById={componentById} transitions={transitions} />
            </>
          )}
          {selectedScenarioEdge && (
            <>
              <div className="inspector-title-row"><div><span>Configured attack transition</span><h3>{selectedScenarioEdge.label}</h3></div><StatusPill tone={runtimeStatuses[selectedScenarioEdge.stepIndex]}>{runtimeStatuses[selectedScenarioEdge.stepIndex]}</StatusPill></div>
              <p className="inspector-copy">{selectedScenarioEdge.note}</p>
              <div className="scenario-provenance-note">Dotted overlay from an explicit <code>depends_on</code> relation. It is causal scenario configuration, not automatically an MCA-derived message edge.</div>
              <dl className="inspector-facts">
                <div><dt>Dependency</dt><dd>{selectedScenarioEdge.sourceStepId} → {selectedScenarioEdge.stepId}</dd></div><div><dt>Activation</dt><dd>T+{selectedScenarioEdge.atSeconds}s</dd></div>
                <div><dt>Secure outcome</dt><dd>{selectedScenarioStep?.secure_status ?? 'not declared'}</dd></div><div><dt>Vulnerable outcome</dt><dd>{selectedScenarioStep?.vulnerable_status ?? 'not declared'}</dd></div>
              </dl>
              <div className="scenario-runtime-guard">
                <span>Full configured stage guard · not MCA-derived</span>
                <code>{configuredStageGuard(scenario, selectedScenarioEdge.stepIndex)}</code>
                <small>Current inputs: T+{Math.round(time)}s · {flightPhase} · {Math.round(heightAglFt).toLocaleString()} ft AGL · result {runtimeStatuses[selectedScenarioEdge.stepIndex]}</small>
              </div>
              <ScenarioEvidenceDetails scenario={scenario} componentById={componentById} transitions={transitions} selectedEdge={selectedScenarioEdge} />
            </>
          )}
          {!selection && !trace && (
            <div className="inspector-empty">
              <Network size={28} />
              <strong>Inspect the analyzed aircraft system</strong>
              <span>Select a component or transition. The graph highlights its full upstream and downstream context.</span>
              <div><b>{scenario.title}</b><small>{scenarioEnabled ? `Scenario armed · ${flightPhase} · ${Math.round(heightAglFt).toLocaleString()} ft AGL.` : 'Scenario is not armed.'}</small></div>
              <ScenarioEvidenceDetails scenario={scenario} componentById={componentById} transitions={transitions} />
            </div>
          )}

          {((selection && !selectedPhysicalNode && !selectedPhysicalEdge) || trace) && (
            <McaConstraintEvidence
              artifact={artifact}
              profile={profile}
              records={constraintRecords}
              preferredMessageId={traceMessageId}
              scopeLabel={constraintScope}
              concreteMessage={concreteTraceMessage}
            />
          )}

          {trace && (
            <div className="trace-inspector">
              <div className="trace-heading"><span>Symbolic origin trace</span><strong>Message #{trace.messageId}</strong><small>Longest of {trace.alternatives} MCA path{trace.alternatives === 1 ? '' : 's'}</small></div>
              <ol>
                {trace.entries.map(([messageId, componentName, inputs], index) => (
                  <li key={`${messageId}-${index}`}><i /><div><strong>{componentName}</strong><span>message #{messageId}{inputs.length ? ` · consumes ${inputs.join(', ')}` : ' · configured source'}</span></div></li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>

      <details className="topology-accessible-list">
        <summary>Text alternative: analyzed components and transitions</summary>
        <div>
          <section><h4>Components</h4><ul>{components.map((component) => <li key={component.id}><button type="button" onClick={() => { setSelection({ kind: 'node', id: String(component.id) }); setTraceMessageId(null) }}><strong>{component.name}</strong><span>{component.role ?? component.kind ?? 'component'}</span></button></li>)}</ul></section>
          <section><h4>Directed transitions</h4><ul>{transitions.map((transition) => <li key={transition.id}><button type="button" onClick={() => { setSelection({ kind: 'edge', id: transition.id }); setTraceMessageId(chooseBestTraceMessage(artifact, transition.messageIds)) }}><strong>{componentById.get(transition.sourceId)?.name ?? transition.sourceId} → {componentById.get(transition.targetId)?.name ?? transition.targetId}</strong><span>{transition.channelNames.map(humanize).join(', ')}</span></button></li>)}</ul></section>
          <section><h4>Configured physical layer</h4><ul>{graph.physicalNodes.map((element) => <li key={element.id}><button type="button" onClick={() => { setSelection({ kind: 'node', id: element.id }); setTraceMessageId(null) }}><strong>{element.label}</strong><span>{element.relation}</span></button></li>)}</ul></section>
          <section><h4>Configured plant relations</h4><ul>{graph.physicalEdges.map((edge) => <li key={edge.id}><button type="button" onClick={() => { setSelection({ kind: 'edge', id: edge.id }); setTraceMessageId(null) }}><strong>{edge.label}</strong><span>{edge.description}</span></button></li>)}</ul></section>
          <section className="scenario-transition-list"><h4>Configured scenario transitions</h4><ul>{graph.scenarioEdges.map((edge) => {
            const related = boundTransitionForScenarioEdge(edge, transitions, scenario)
            return <li key={edge.id}><button type="button" onClick={() => { setSelection({ kind: 'edge', id: edge.id }); setTraceMessageId(related ? chooseBestTraceMessage(artifact, related.messageIds) : null) }}><strong>{elementLabel(edge.sourceId ?? 'configured_source')} → {elementLabel(edge.targetId ?? 'configured_target')}</strong><span>{edge.sourceStepId} → {edge.stepId} · {edge.label} · configured at T+{edge.atSeconds}s</span></button></li>
          })}</ul></section>
        </div>
      </details>
    </div>
  )
}
