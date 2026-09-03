import { ArrowRight, CircleDot, Network } from 'lucide-react'
import { propagationStatus, scenarioIsEffective } from '../sim/engine'
import type { AttackScenario, FlightPhase, Profile, PropagationStatus } from '../types'
import { StatusPill } from './StatusPill'

const statusLabel: Record<PropagationStatus, string> = {
  dormant: 'Dormant',
  armed: 'Armed / gated',
  attempted: 'Attempted',
  propagated: 'Propagated',
  blocked: 'Blocked',
  recovered: 'Recovered',
  unsafe: 'Unsafe effect',
}

interface PropagationGraphProps {
  scenario: AttackScenario
  enabled: boolean
  time: number
  flightPhase: FlightPhase
  heightAglFt: number
  profile: Profile
  onProfileChange: (profile: Profile) => void
}

export function PropagationGraph({ scenario, enabled, time, flightPhase, heightAglFt, profile, onProfileChange }: PropagationGraphProps) {
  const nodes = scenario.steps.map((step, index) => ({
    ...step,
    status: enabled ? propagationStatus(profile, scenario, index, time, flightPhase, heightAglFt) : 'dormant' as const,
  }))
  const terminal = nodes.at(-1)?.status
  const effective = enabled && scenarioIsEffective(scenario, time, flightPhase, heightAglFt)

  return (
    <section className="panel propagation-panel">
      <header className="panel-header">
        <div>
          <span className="eyebrow"><Network size={13} /> Runtime causal trace</span>
          <h2>Component propagation</h2>
        </div>
        <div className="segmented-control" role="tablist" aria-label="Aircraft profile">
          {(['secure', 'vulnerable'] as const).map((item) => (
            <button role="tab" aria-selected={profile === item} className={profile === item ? 'active' : ''} onClick={() => onProfileChange(item)} key={item}>{item}</button>
          ))}
        </div>
      </header>
      <div className="propagation-summary">
        <div>
          <span>Focused chain</span>
          <strong>{scenario.title}</strong>
          <small>{enabled ? effective ? 'Effect gate satisfied now' : 'Armed; timing / operating gate applies' : 'Scenario not armed'} · {flightPhase} · {Math.round(heightAglFt).toLocaleString()} ft AGL</small>
        </div>
        <StatusPill tone={terminal ?? 'dormant'}>{statusLabel[terminal ?? 'dormant']}</StatusPill>
      </div>
      <div className="propagation-flow" role="list" aria-label={`${profile} component propagation path`}>
        {nodes.map((node, index) => (
          <div className="propagation-segment" key={`${scenario.id}-${node.id}`}>
            <article className={`propagation-node status-${node.status}`} role="listitem">
              <div className="node-topline"><CircleDot size={13} /><span>T+{node.at_seconds}s</span></div>
              <strong>{node.component.replaceAll('_', ' ')}</strong>
              <small>{node.label}</small>
              <em>{statusLabel[node.status]}</em>
            </article>
            {index < nodes.length - 1 && nodes[index + 1].depends_on.includes(node.id)
              ? <ArrowRight className={`flow-arrow ${node.status !== 'dormant' ? 'active' : ''}`} size={19} aria-label={`${node.id} precedes ${nodes[index + 1].id}`} />
              : index < nodes.length - 1 ? <span className="flow-gap" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
      <div className="status-key" aria-label="Propagation status legend">
        {(['dormant', 'armed', 'attempted', 'propagated', 'blocked', 'recovered', 'unsafe'] as PropagationStatus[]).map((status) => <span key={status}><i className={`key-${status}`} />{statusLabel[status]}</span>)}
      </div>
    </section>
  )
}
