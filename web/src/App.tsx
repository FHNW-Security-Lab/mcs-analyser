import { useEffect, useMemo, useRef, useState } from 'react'
import { Plane, Radio, ShieldCheck, TriangleAlert, Wifi, WifiOff } from 'lucide-react'
import { loadAnalysis, loadConfig } from './api'
import { fallbackConfig } from './data/fallback'
import { advanceAircraftForDuration, classifySafety, initialAircraftState, scenarioIsEffective, type SimulationContext } from './sim/engine'
import type { AircraftState, McaArtifact, Profile, ReachabilityResult, SafetyLimits } from './types'
import { AnalysisPanel } from './components/AnalysisPanel'
import { AttackPanel } from './components/AttackPanel'
import { AttitudeIndicator } from './components/AttitudeIndicator'
import { AviationMap } from './components/AviationMap'
import { PropagationGraph } from './components/PropagationGraph'
import { ReachabilityPanel } from './components/ReachabilityPanel'
import { SafetyControls } from './components/SafetyControls'
import { SimulationControls } from './components/SimulationControls'
import { VerticalProfile } from './components/VerticalProfile'
import { LiveMcaConstraints } from './components/LiveMcaConstraints'
import { LiveMcaSystemGraph } from './components/LiveMcaSystemGraph'

const initialContext: SimulationContext = {
  route: fallbackConfig.routes[0],
  attacks: [fallbackConfig.attacks[0]],
  safety: fallbackConfig.safety_defaults,
}

const appendFlightHistory = (history: AircraftState[], next: AircraftState): AircraftState[] => {
  const last = history.at(-1)
  if (last && next.time - last.time < 1 && next.flightPhase === last.flightPhase) return history
  return [...history, next].slice(-1_400)
}

type Workspace = 'flight' | 'scenarios' | 'propagation' | 'reachability' | 'mca'

export default function App() {
  const [config, setConfig] = useState(fallbackConfig)
  const [offlineConfig, setOfflineConfig] = useState(false)
  const [routeId, setRouteId] = useState(fallbackConfig.routes[0].id)
  const [selectedAttackIds, setSelectedAttackIds] = useState<string[]>([
    'gnss_spoof',
    'afdx_injection',
    'mcdu_altitude_tamper',
    'radio_altimeter_fault',
  ])
  const [focusedAttackId, setFocusedAttackId] = useState('gnss_spoof')
  const [safety, setSafety] = useState<SafetyLimits>(fallbackConfig.safety_defaults)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [propagationProfile, setPropagationProfile] = useState<Profile>('secure')
  const [secureState, setSecureState] = useState(() => initialAircraftState('secure', initialContext))
  const [vulnerableState, setVulnerableState] = useState(() => initialAircraftState('vulnerable', initialContext))
  const [secureHistory, setSecureHistory] = useState<AircraftState[]>([secureState])
  const [vulnerableHistory, setVulnerableHistory] = useState<AircraftState[]>([vulnerableState])
  const [reachability, setReachability] = useState<ReachabilityResult | null>(null)
  const [workspace, setWorkspace] = useState<Workspace>('flight')
  const [liveMcaProfile, setLiveMcaProfile] = useState<Profile>('secure')
  const [mcaArtifacts, setMcaArtifacts] = useState<Partial<Record<Profile, McaArtifact>>>({})
  const mainRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [workspace])

  useEffect(() => {
    void loadConfig().then(({ config: loaded, offline }) => {
      setConfig(loaded)
      setOfflineConfig(offline)
      setSafety(loaded.safety_defaults)
      setRouteId((current) => loaded.routes.some((route) => route.id === current) ? current : loaded.routes[0].id)
    })
  }, [])

  useEffect(() => {
    let mounted = true
    void Promise.allSettled([loadAnalysis('secure'), loadAnalysis('vulnerable')]).then(([secure, vulnerable]) => {
      if (!mounted) return
      setMcaArtifacts({
        ...(secure.status === 'fulfilled' ? { secure: secure.value } : {}),
        ...(vulnerable.status === 'fulfilled' ? { vulnerable: vulnerable.value } : {}),
      })
    })
    return () => { mounted = false }
  }, [])

  const route = config.routes.find((candidate) => candidate.id === routeId) ?? config.routes[0]
  const selectedAttacks = useMemo(
    () => config.attacks.filter((attack) => selectedAttackIds.includes(attack.id)),
    [config.attacks, selectedAttackIds],
  )
  const focusedAttack = config.attacks.find((attack) => attack.id === focusedAttackId) ?? config.attacks[0]
  const context = useMemo<SimulationContext>(() => ({ route, attacks: selectedAttacks, safety }), [route, selectedAttacks, safety])
  const reachabilityHorizon = config.analysis_scope.default_horizon_seconds
  const simulationHorizon = config.analysis_scope.simulation_horizon_seconds ?? 1200
  const destinationElevationFt = route.points.at(-1)?.altitude_ft ?? 0
  const secureHeightAglFt = Math.max(0, secureState.altitudeFt - destinationElevationFt)
  const vulnerableHeightAglFt = Math.max(0, vulnerableState.altitudeFt - destinationElevationFt)
  const propagationState = propagationProfile === 'secure' ? secureState : vulnerableState
  const propagationHeightAglFt = propagationProfile === 'secure' ? secureHeightAglFt : vulnerableHeightAglFt

  const resetSimulation = () => {
    const secure = initialAircraftState('secure', context)
    const vulnerable = initialAircraftState('vulnerable', context)
    setPlaying(false)
    setSecureState(secure)
    setVulnerableState(vulnerable)
    setSecureHistory([secure])
    setVulnerableHistory([vulnerable])
  }

  useEffect(() => {
    resetSimulation()
    // A route change changes the local route frame and must create a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  useEffect(() => {
    if (!playing) return
    const interval = window.setInterval(() => {
      setSecureState((current) => {
        if (current.time >= simulationHorizon) {
          setPlaying(false)
          return current
        }
        const next = advanceAircraftForDuration(current, 'secure', context, Math.min(0.1 * speed, simulationHorizon - current.time))
        setSecureHistory((history) => appendFlightHistory(history, next))
        return next
      })
      setVulnerableState((current) => {
        if (current.time >= simulationHorizon) return current
        const next = advanceAircraftForDuration(current, 'vulnerable', context, Math.min(0.1 * speed, simulationHorizon - current.time))
        setVulnerableHistory((history) => appendFlightHistory(history, next))
        return next
      })
    }, 100)
    return () => window.clearInterval(interval)
  }, [playing, speed, context, simulationHorizon])

  useEffect(() => {
    setSecureState((current) => ({ ...current, safetyViolations: classifySafety(current, safety) }))
    setVulnerableState((current) => ({ ...current, safetyViolations: classifySafety(current, safety) }))
  }, [safety])

  const toggleAttack = (id: string) => {
    setSelectedAttackIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
    setFocusedAttackId(id)
  }

  const secureEnvelope = reachability?.profiles.secure.envelope
  const vulnerableEnvelope = reachability?.profiles.vulnerable.envelope
  const activeAttackCount = selectedAttacks.filter((attack) => scenarioIsEffective(
    attack,
    secureState.time,
    secureState.flightPhase,
    secureHeightAglFt,
  )).length
  const vulnerableUnsafe = vulnerableState.safetyViolations.length > 0

  return (
    <div className="app-shell visual-app">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setWorkspace('flight')} aria-label="Open ALBATROS flight view">
          <span className="brand-mark"><Plane size={21} /></span>
          <span><strong>ALBATROS</strong><small>ASSURANCE LAB</small></span>
        </button>
        <nav className="workspace-tabs" aria-label="Application views">
          {([
            ['flight', 'Flight'],
            ['scenarios', 'Scenarios'],
            ['propagation', 'Propagation'],
            ['reachability', 'Reachability'],
            ['mca', 'MCA'],
          ] as Array<[Workspace, string]>).map(([id, label]) => (
            <button type="button" className={workspace === id ? 'active' : ''} aria-current={workspace === id ? 'page' : undefined} onClick={() => setWorkspace(id)} key={id}>{label}</button>
          ))}
        </nav>
        <div className={`backend-status ${offlineConfig ? 'offline' : ''}`} title={offlineConfig ? 'Using bundled configuration; API not reached' : 'Backend configuration loaded'}>
          {offlineConfig ? <WifiOff size={14} /> : <Wifi size={14} />}
          <span>{offlineConfig ? 'CONFIG FALLBACK' : 'ANALYSIS API ONLINE'}</span>
        </div>
      </header>

      <main ref={mainRef} id="top" className="app-main">
        <section className="app-statusbar" aria-label="Mission status">
          <div className="mission-context-panel">
            <div className="mission-route-compact">
              <span><Radio size={12} /> MISSION / ALB-{route.id.toUpperCase()}</span>
              <div><strong>{route.origin.split(' / ')[0]}</strong><i /><Plane size={16} /><i /><strong>{route.destination.split(' / ')[0]}</strong></div>
            </div>
            <div className="mission-runtime">
              <div className="mission-kpis">
                <div><span>SIM CLOCK</span><strong>T+{Math.round(secureState.time).toString().padStart(3, '0')}s</strong></div>
                <div><span>ARMED</span><strong>{selectedAttacks.length.toString().padStart(2, '0')}</strong></div>
                <div><span>ACTIVE</span><strong>{activeAttackCount.toString().padStart(2, '0')}</strong></div>
                <div><span>BUS</span><strong>AFDX</strong></div>
              </div>
              <div className="mission-health">
                <span className="secure"><ShieldCheck size={13} /> SECURE · {secureState.safetyViolations.length ? 'LIMIT' : 'CONTAINED'}</span>
                <span className={vulnerableUnsafe ? 'unsafe' : 'vulnerable'}><TriangleAlert size={13} /> BASELINE · {vulnerableUnsafe ? 'UNSAFE' : 'NOMINAL'}</span>
              </div>
            </div>
          </div>
        </section>

        {workspace === 'flight' && <section className="dashboard-section workspace-view" id="simulation">
          <div className="workspace-title"><h1>Live flight comparison</h1></div>
          <SimulationControls
            routes={config.routes}
            routeId={routeId}
            onRouteChange={setRouteId}
            playing={playing}
            onPlayToggle={() => setPlaying((value) => !value)}
            onReset={resetSimulation}
            time={secureState.time}
            flightPhase={secureState.flightPhase}
            horizon={simulationHorizon}
            speed={speed}
            onSpeedChange={setSpeed}
          />
          <div className="flight-primary-grid">
            <div className="map-comparison-grid">
              <AviationMap profile="secure" route={route} state={secureState} history={secureHistory} envelope={secureEnvelope} maxCourseDeviationNm={safety.max_course_deviation_nm} />
              <AviationMap profile="vulnerable" route={route} state={vulnerableState} history={vulnerableHistory} envelope={vulnerableEnvelope} maxCourseDeviationNm={safety.max_course_deviation_nm} />
            </div>
            <LiveMcaConstraints
              secureState={secureState}
              vulnerableState={vulnerableState}
              secureHeightAglFt={secureHeightAglFt}
              vulnerableHeightAglFt={vulnerableHeightAglFt}
              attacks={selectedAttacks}
              safety={safety}
              artifacts={mcaArtifacts}
              profile={liveMcaProfile}
              onProfileChange={setLiveMcaProfile}
              onOpenGraph={() => setWorkspace('mca')}
            />
          </div>
          <LiveMcaSystemGraph
            artifacts={mcaArtifacts}
            profile={liveMcaProfile}
            onProfileChange={setLiveMcaProfile}
            state={liveMcaProfile === 'secure' ? secureState : vulnerableState}
            heightAglFt={liveMcaProfile === 'secure' ? secureHeightAglFt : vulnerableHeightAglFt}
            attacks={selectedAttacks}
            safety={safety}
          />
          <VerticalProfile route={route} secureState={secureState} vulnerableState={vulnerableState} secureHistory={secureHistory} vulnerableHistory={vulnerableHistory} />
          <div className="attitude-comparison-grid">
            <AttitudeIndicator profile="secure" state={secureState} />
            <AttitudeIndicator profile="vulnerable" state={vulnerableState} />
          </div>
        </section>}

        {workspace === 'scenarios' && <section className="dashboard-section workspace-view scenarios-section">
          <div className="workspace-title"><h1>Scenarios &amp; limits</h1></div>
          <div className="scenario-config-grid">
            <AttackPanel scenarios={config.attacks} selectedIds={selectedAttackIds} focusedId={focusedAttackId} onToggle={toggleAttack} onFocus={setFocusedAttackId} time={secureState.time} flightPhase={secureState.flightPhase} heightAglFt={secureHeightAglFt} />
            <SafetyControls limits={safety} onChange={setSafety} />
          </div>
        </section>}

        {workspace === 'propagation' && <section className="dashboard-section workspace-view" id="propagation">
          <div className="workspace-title"><h1>Propagation observatory</h1></div>
          <PropagationGraph scenario={focusedAttack} enabled={selectedAttackIds.includes(focusedAttack.id)} time={propagationState.time} flightPhase={propagationState.flightPhase} heightAglFt={propagationHeightAglFt} profile={propagationProfile} onProfileChange={setPropagationProfile} />
        </section>}

        {workspace === 'reachability' && <section className="dashboard-section workspace-view" id="reachability">
          <div className="workspace-title"><h1>Bounded reachable states</h1></div>
          <ReachabilityPanel attackIds={selectedAttackIds} safety={safety} defaultHorizon={reachabilityHorizon} defaultStep={config.analysis_scope.default_step_seconds} onResult={setReachability} />
        </section>}

        {workspace === 'mca' && <section className="dashboard-section workspace-view evidence-section">
          <div className="workspace-title"><h1>MCA analysis</h1></div>
          <AnalysisPanel scenario={focusedAttack} scenarioEnabled={selectedAttackIds.includes(focusedAttack.id)} time={secureState.time} flightPhase={secureState.flightPhase} heightAglFt={secureHeightAglFt} secureState={secureState} vulnerableState={vulnerableState} />
        </section>}
      </main>
    </div>
  )
}
