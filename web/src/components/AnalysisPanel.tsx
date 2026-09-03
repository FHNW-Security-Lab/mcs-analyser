import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Binary, CheckCircle2, CircleOff, LoaderCircle, Network, Play, RefreshCw } from 'lucide-react'
import { loadAnalysis, runAnalysis } from '../api'
import { aggregateMcaTransitions } from '../graph/mcaTopology'
import type { AircraftState, AttackScenario, FlightPhase, McaArtifact, Profile } from '../types'
import { McaTopologyGraph } from './McaTopologyGraph'
import { InverseReachabilityQuery } from './InverseReachabilityQuery'

type EvidenceView = 'topology' | 'backward'

interface AnalysisPanelProps {
  scenario: AttackScenario
  scenarioEnabled: boolean
  time: number
  flightPhase: FlightPhase
  heightAglFt: number
  secureState: AircraftState
  vulnerableState: AircraftState
}

export function AnalysisPanel({ scenario, scenarioEnabled, time, flightPhase, heightAglFt, secureState, vulnerableState }: AnalysisPanelProps) {
  const [profile, setProfile] = useState<Profile>('secure')
  const [view, setView] = useState<EvidenceView>('topology')
  const [artifacts, setArtifacts] = useState<Partial<Record<Profile, McaArtifact>>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    const outcomes = await Promise.allSettled([loadAnalysis('secure'), loadAnalysis('vulnerable')])
    const next: Partial<Record<Profile, McaArtifact>> = {}
    if (outcomes[0].status === 'fulfilled') next.secure = outcomes[0].value
    if (outcomes[1].status === 'fulfilled') next.vulnerable = outcomes[1].value
    setArtifacts(next)
    if (!next.secure && !next.vulnerable) {
      const failure = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult | undefined
      setError(failure?.reason instanceof Error ? failure.reason.message : 'No MCA artifacts are available.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const rerun = async () => {
    setRunning(true)
    setError(null)
    try {
      await runAnalysis()
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Native analysis failed')
    } finally {
      setRunning(false)
    }
  }

  const artifact = artifacts[profile]
  const components = artifact?.components ?? artifact?.nodes ?? []
  const edges = artifact?.communication_edges ?? artifact?.edges ?? []
  const constraints = artifact?.constraints ?? []
  const logicalTransitions = useMemo(() => aggregateMcaTransitions(edges), [edges])
  const completed = artifact?.analysis?.completed_real_angr_run === true

  return (
    <section className="panel analysis-panel" id="mca-analysis">
      <header className="panel-header analysis-header">
        <div>
          <span className="eyebrow"><Binary size={13} /> Native symbolic component analysis</span>
          <h2>MCA binary evidence</h2>
        </div>
        <button className="action-button" onClick={() => void rerun()} disabled={running || loading}>
          {running ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
          {running ? 'Running angr…' : 'Re-run both profiles'}
        </button>
      </header>

      <div className="analysis-toolbar">
        <div className="segmented-control" role="tablist" aria-label="MCA profile">
          {(['secure', 'vulnerable'] as const).map((item) => (
            <button role="tab" aria-selected={profile === item} className={profile === item ? 'active' : ''} onClick={() => setProfile(item)} key={item}>
              {item} {artifacts[item] && <i className="tab-ready" />}
            </button>
          ))}
        </div>
        <div className="subtabs" role="tablist" aria-label="MCA evidence view">
          <button id="mca-tab-topology" aria-controls="mca-panel-topology" role="tab" aria-selected={view === 'topology'} className={view === 'topology' ? 'active' : ''} onClick={() => setView('topology')}><Network size={14} /> System graph</button>
          <button id="mca-tab-backward" aria-controls="mca-panel-backward" role="tab" aria-selected={view === 'backward'} className={view === 'backward' ? 'active' : ''} onClick={() => setView('backward')}><ArrowLeft size={14} /> Target-state query</button>
        </div>
      </div>

      {loading && <div className="analysis-empty" aria-live="polite" aria-busy="true"><LoaderCircle className="spin" /><strong>Loading native analysis artifacts…</strong><span>/analysis/aviation-secure.json · aviation-vulnerable.json</span></div>}
      {!loading && error && !artifact && (
        <div className="analysis-empty error-state"><CircleOff /><strong>MCA artifact unavailable</strong><span>{error}</span><button className="action-button" onClick={() => void rerun()}><Play size={15} /> Run native analysis</button></div>
      )}

      {!loading && artifact && (
        <>
          <div className="analysis-runbar">
            <div className={`run-verification ${completed ? 'verified' : 'partial'}`}>
              {completed ? <CheckCircle2 size={17} /> : <CircleOff size={17} />}
              <div><strong>{completed ? 'Completed real angr run' : 'Partial / unverified run'}</strong><span>{artifact.analysis?.execution_mode ?? 'native binary symbolic execution'}</span></div>
            </div>
            <div className="analysis-stats">
              <div><strong>{components.length}</strong><span>components</span></div>
              <div><strong>{logicalTransitions.length}</strong><span>system transitions</span></div>
              <div><strong>{edges.length}</strong><span>symbolic edge instances</span></div>
              <div><strong>{constraints.length}</strong><span>constraint records</span></div>
              <div><strong>{Number(artifact.summary?.reachable_message_count ?? 0)}</strong><span>reachable messages</span></div>
            </div>
          </div>

          {view === 'topology' && (
            <div id="mca-panel-topology" role="tabpanel" aria-labelledby="mca-tab-topology">
              <McaTopologyGraph artifact={artifact} profile={profile} scenario={scenario} scenarioEnabled={scenarioEnabled} time={time} flightPhase={flightPhase} heightAglFt={heightAglFt} aircraftState={profile === 'secure' ? secureState : vulnerableState} />
            </div>
          )}

          {view === 'backward' && (
            <div id="mca-panel-backward" role="tabpanel" aria-labelledby="mca-tab-backward">
              <InverseReachabilityQuery artifacts={artifacts} scenario={scenario} secureState={secureState} vulnerableState={vulnerableState} />
            </div>
          )}

        </>
      )}
    </section>
  )
}
