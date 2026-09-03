import { useEffect, useRef, useState } from 'react'
import { CircleHelp, LoaderCircle, Play, ShieldCheck, Sigma, TriangleAlert } from 'lucide-react'
import { computeReachability } from '../api'
import type { Profile, ReachabilityResult, SafetyLimits } from '../types'
import { StatusPill } from './StatusPill'

interface ReachabilityPanelProps {
  attackIds: string[]
  safety: SafetyLimits
  defaultHorizon: number
  defaultStep: number
  onResult: (result: ReachabilityResult | null) => void
}

const propertyLabels: Record<string, string> = {
  roll: 'Roll envelope',
  pitch: 'Pitch envelope',
  yaw_rate: 'Yaw rate',
  course_deviation: 'Cross-track',
  altitude_deviation: 'Altitude error',
  fms_steering_freshness: 'FMS steering freshness',
  navigation_reversion_integrity: 'Navigation reversion',
  radio_height_availability: 'Radio-height availability',
  proof_tube_consistency: 'Proof-tube consistency',
}

export function ReachabilityPanel({ attackIds, safety, defaultHorizon, defaultStep, onResult }: ReachabilityPanelProps) {
  const [result, setResult] = useState<ReachabilityResult | null>(null)
  const [horizon, setHorizon] = useState(defaultHorizon)
  const [step, setStep] = useState(defaultStep)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) setStale(true)
    initialized.current = true
  }, [attackIds.join(','), safety])

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await computeReachability(attackIds, safety, horizon, step)
      setResult(response)
      onResult(response)
      setStale(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Reachability request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel reachability-panel">
      <header className="panel-header">
        <div>
          <span className="eyebrow"><Sigma size={13} /> Bounded state &amp; function model</span>
          <h2>Aircraft-state reachability</h2>
        </div>
        <div className="reach-run-controls">
          <label>Horizon <input type="number" min="30" max="360" step="6" value={horizon} onChange={(event) => { setHorizon(Number(event.target.value)); setStale(true) }} /> s</label>
          <label>Step <select value={step} onChange={(event) => { setStep(Number(event.target.value)); setStale(true) }}><option value="3">3 s</option><option value="6">6 s</option><option value="9">9 s</option><option value="12">12 s</option></select></label>
          <button className="action-button primary" onClick={() => void run()} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}
            {loading ? 'Propagating…' : result ? 'Recompute bounds' : 'Compute bounds'}
          </button>
        </div>
      </header>

      {error && <div className="inline-error"><TriangleAlert size={16} /><span><strong>Reachability unavailable:</strong> {error}</span></div>}
      {result && (
        <>
          {stale && <div className="stale-banner"><CircleHelp size={15} /> Inputs changed — displayed bounds are stale until recomputed.</div>}
          <div className="profile-result-grid">
            {(['secure', 'vulnerable'] as Profile[]).map((profile) => {
              const data = result.profiles[profile]
              return (
                <article className={`reach-profile ${profile} classification-${data.classification}`} key={profile}>
                  <header>
                    <div><span>{profile} aircraft</span><strong>{data.classification.replace('-', ' ')}</strong></div>
                    {data.classification === 'bounded-safe' ? <ShieldCheck size={23} /> : data.classification === 'unsafe' ? <TriangleAlert size={23} /> : <CircleHelp size={23} />}
                  </header>
                  <div className="property-grid">
                    {Object.entries(data.properties).map(([key, property]) => (
                      <div className={`property-result ${property.violated === true ? 'failed' : property.violated === false ? 'passed' : 'unknown'}`} key={key} title={property.solver}>
                        <span>{propertyLabels[key] ?? key}</span>
                        <StatusPill tone={property.violated === true ? 'unsafe' : property.violated === false ? 'recovered' : 'warning'}>{property.status}</StatusPill>
                        <small>{property.witness !== null ? `witness ${property.witness.toFixed(2)} ${property.unit} @ T+${property.witness_seconds}s` : `limit ${property.limit.toLocaleString()} ${property.unit}`}</small>
                      </div>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
