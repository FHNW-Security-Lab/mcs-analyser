import { CloudLightning, RadioTower, Router, ShieldAlert, TabletSmartphone, TriangleAlert } from 'lucide-react'
import { scenarioIsEffective } from '../sim/engine'
import type { AttackScenario, FlightPhase } from '../types'

const scenarioIcon = (id: string) => {
  if (id.includes('gnss') || id.includes('nav')) return RadioTower
  if (id.includes('weather') || id.includes('gust')) return CloudLightning
  if (id.includes('efb') || id.includes('mcdu')) return TabletSmartphone
  if (id.includes('afdx') || id.includes('fms')) return Router
  if (id.includes('altimeter')) return TriangleAlert
  return ShieldAlert
}

const coverageLabel: Record<AttackScenario['evidence']['coverage'], string> = {
  native: 'Native MCA',
  partial: 'Partial MCA',
  configured: 'Configured only',
  plant: 'Plant model',
}

interface AttackPanelProps {
  scenarios: AttackScenario[]
  selectedIds: string[]
  focusedId: string
  onToggle: (id: string) => void
  onFocus: (id: string) => void
  time: number
  flightPhase: FlightPhase
  heightAglFt: number
}

export function AttackPanel({ scenarios, selectedIds, focusedId, onToggle, onFocus, time, flightPhase, heightAglFt }: AttackPanelProps) {
  const focused = scenarios.find((item) => item.id === focusedId) ?? scenarios[0]
  const focusedEffective = focused ? scenarioIsEffective(focused, time, flightPhase, heightAglFt) : false

  return (
    <section className="panel attack-panel">
      <header className="panel-header">
        <div>
          <span className="eyebrow">Scenario injection</span>
          <h2>Attack &amp; fault library</h2>
        </div>
        <span className="selection-count">{selectedIds.length} armed</span>
      </header>
      <div className="attack-list">
        {scenarios.map((scenario) => {
          const Icon = scenarioIcon(scenario.id)
          const checked = selectedIds.includes(scenario.id)
          const effective = checked && scenarioIsEffective(scenario, time, flightPhase, heightAglFt)
          return (
            <div
              className={`attack-option ${checked ? 'selected armed' : ''} ${effective ? 'effective' : ''} ${focusedId === scenario.id ? 'focused' : ''}`}
              key={scenario.id}
            >
              <label onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(scenario.id)} aria-label={`Enable ${scenario.title}`} />
                <span className="check-control" />
              </label>
              <Icon size={18} />
              <button type="button" className="attack-option-copy" onClick={() => onFocus(scenario.id)} aria-pressed={focusedId === scenario.id}>
                <strong>{scenario.title}</strong>
                <span>{scenario.category} · {scenario.signal_property} · T+{scenario.activation_seconds}s</span>
                <i className={`coverage-badge coverage-${scenario.evidence.coverage}`}>{coverageLabel[scenario.evidence.coverage]}</i>
              </button>
              {effective
                ? <i className="active-pulse" role="img" title="Effect currently applied" aria-label="Effect currently applied" />
                : checked
                  ? <i className="armed-indicator" role="img" title="Armed; effect is not currently applied" aria-label="Armed; effect not currently applied" />
                  : null}
            </div>
          )
        })}
      </div>

      {focused && (
        <div className="attack-detail">
          <div className="attack-detail-heading">
            <div><span className={`category-tag ${focused.category}`}>{focused.category}</span><strong>{focused.title}</strong></div>
          </div>

          <div className={`scenario-runtime-state ${selectedIds.includes(focused.id) ? focusedEffective ? 'effective' : 'armed' : 'disarmed'}`}>
            <span>{selectedIds.includes(focused.id) ? focusedEffective ? 'Effect applied now' : 'Armed, gate not yet satisfied' : 'Not armed'}</span>
            <strong>T+{Math.round(time)}s · {flightPhase} · {Math.round(heightAglFt).toLocaleString()} ft AGL</strong>
          </div>

          <div className="step-timeline" aria-label={`${focused.title} step timeline`}>
            {focused.steps.map((step, index) => {
              const elapsed = time >= step.at_seconds
              return (
                <div className={`timeline-step ${elapsed ? 'elapsed' : ''}`} key={`${focused.id}-${step.id}`}>
                  <span className="step-dot">{index + 1}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.component.replaceAll('_', ' ')} · T+{step.at_seconds}s</small>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
