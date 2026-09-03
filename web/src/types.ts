export type Profile = 'secure' | 'vulnerable'

export interface RoutePoint {
  id: string
  label: string
  lat: number
  lon: number
  altitude_ft: number
}

export interface FlightPerformance {
  takeoff_roll_seconds: number
  rotate_speed_kt: number
  climb_speed_kt: number
  descent_speed_kt: number
  approach_speed_kt: number
  max_climb_fpm: number
  max_descent_fpm: number
}

export interface Route {
  id: string
  name: string
  origin: string
  destination: string
  cruise_speed_kt: number
  performance: FlightPerformance
  points: RoutePoint[]
  note: string
}

export type FlightPhase =
  | 'GROUND ROLL'
  | 'ROTATION'
  | 'CLIMB'
  | 'CRUISE'
  | 'DESCENT'
  | 'APPROACH'
  | 'LANDED'

export type PropagationStatus =
  | 'dormant'
  | 'armed'
  | 'attempted'
  | 'propagated'
  | 'blocked'
  | 'recovered'
  | 'unsafe'

export type AttackStepKind =
  | 'attempt'
  | 'exploit'
  | 'fault'
  | 'environment'
  | 'propagate'
  | 'decision'
  | 'effect'

export interface AttackStep {
  id: string
  label: string
  component: string
  at_seconds: number
  kind: AttackStepKind
  depends_on: string[]
  note: string
  secure_status: PropagationStatus
  vulnerable_status: PropagationStatus
}

export interface AttackMagnitude {
  gps_bias_m?: number
  gps_bias_rate_mps?: number
  radio_bias_m?: number
  route_offset_m?: number
  roll_injection_deg?: number
  radio_altimeter_loss?: number
  crosswind_mps?: number
  vertical_gust_mps?: number
  nav_output_bias_m?: number
  fms_steering_dropout?: number
  navigation_loss?: number
  stale_roll_bound_deg?: number
  stale_pitch_bound_deg?: number
  mcdu_altitude_offset_ft?: number
  airspeed_bias_kt?: number
}

export type SignalProperty =
  | 'integrity'
  | 'availability'
  | 'integrity + availability'
  | 'physical disturbance'

export interface ScenarioEffectProfile {
  trigger: 'elapsed_time' | 'flight_phase' | 'elapsed_time_and_phase'
  phase_gate?: FlightPhase[]
  max_agl_ft?: number | null
  rise_seconds: number
  /** Plateau length between rise and fall. Null means persistent after rise. */
  duration_seconds: number | null
  fall_seconds: number
  waveform: 'step' | 'linear' | 'smoothstep' | 'sine_pulse'
  analysis_activation_seconds: number
}

export interface ScenarioEvidence {
  coverage: 'native' | 'partial' | 'configured' | 'plant'
  native_components: string[]
  message_types: string[]
  note: string
}

export interface AttackScenario {
  id: string
  title: string
  category: 'cyber' | 'fault' | 'combined' | 'environment'
  summary: string
  source: string
  activation_seconds: number
  magnitude: AttackMagnitude
  signal_property: SignalProperty
  attack_surface: string
  preconditions: string[]
  operating_window: string
  detection: string[]
  hazard: string
  effect: ScenarioEffectProfile
  evidence: ScenarioEvidence
  secure_response: string
  vulnerable_response: string
  steps: AttackStep[]
  tags: string[]
}

export interface SafetyLimits {
  max_roll_deg: number
  max_pitch_deg: number
  max_yaw_rate_deg_s: number
  max_course_deviation_nm: number
  max_altitude_deviation_ft: number
}

export interface PublicConfig {
  routes: Route[]
  attacks: AttackScenario[]
  safety_defaults: SafetyLimits
  analysis_scope: {
    default_horizon_seconds: number
    default_step_seconds: number
    simulation_horizon_seconds?: number
    coordinate_system: string
    position_claim: string
    bus_model: string
  }
}

export interface GeoPoint {
  lat: number
  lon: number
}

export interface AircraftState {
  time: number
  truePosition: GeoPoint
  estimatedPosition: GeoPoint
  commandedPosition: GeoPoint
  altitudeFt: number
  estimatedAltitudeFt: number
  targetAltitudeFt: number
  commandedAltitudeFt: number
  rollDeg: number
  pitchDeg: number
  angleOfAttackDeg: number
  flightPathAngleDeg: number
  headingDeg: number
  yawRateDegS: number
  commandedRollDeg: number
  commandedPitchDeg: number
  crossTrackM: number
  estimatedCrossTrackM: number
  targetCrossTrackM: number
  alongTrackM: number
  airspeedKt: number
  indicatedAirspeedKt: number
  groundSpeedKt: number
  verticalSpeedFpm: number
  flightPhase: FlightPhase
  navMode: string
  source: string
  busHealth: 'nominal' | 'degraded' | 'compromised'
  safetyViolations: string[]
}

export interface PropagationNode {
  id: string
  label: string
  detail: string
  status: PropagationStatus
  atSeconds: number
}

export interface ReachabilityProperty {
  status: 'contained' | 'witnessed' | 'overapprox' | 'sat' | 'unsat' | 'unknown' | string
  violated: boolean | null
  witness_seconds: number | null
  limit: number
  unit: string
  witness: number | null
  solver: string
}

export interface EnvelopeSample {
  seconds: number
  along_min_m: number
  along_max_m: number
  cross_min_m: number
  cross_max_m: number
  heading_min_deg?: number
  heading_max_deg?: number
  roll_min_deg?: number
  roll_max_deg?: number
  pitch_min_deg?: number
  pitch_max_deg?: number
  yaw_rate_min_deg_s?: number
  yaw_rate_max_deg_s?: number
  altitude_min_m?: number
  altitude_max_m?: number
}

export interface ReachabilityProfile {
  profile: Profile
  classification: 'unsafe' | 'unknown' | 'bounded-safe'
  violated_properties: string[]
  unknown_properties: string[]
  properties: Record<string, ReachabilityProperty>
  envelope: EnvelopeSample[]
  envelope_semantics: string
  witness_traces: Record<string, Array<Record<string, number>>>
  model: {
    dynamics: string
    navigation: string
    bank_guard_deg: number
    time_steps: number
    constraint_count: number
    reachability: string
  }
}

export interface ReachabilityResult {
  schema_version: string
  status: string
  engine: string
  semantics: string
  not_in_scope: string
  attack_ids: string[]
  horizon_seconds: number
  step_seconds: number
  safety: SafetyLimits
  profiles: Record<Profile, ReachabilityProfile>
}

export type InverseTargetField =
  | 'roll_deg'
  | 'pitch_deg'
  | 'yaw_rate_deg_s'
  | 'heading_error_deg'
  | 'course_deviation_nm'
  | 'altitude_deviation_ft'

export type InverseTarget = Partial<Record<InverseTargetField, number>>

export interface InverseWitnessInput {
  input: string
  magnitude_key: string
  value: number
  unit: string
  seconds: number
  scenario_ids: string[]
}

export interface InverseEnablingScenario {
  id: string
  title: string
  evidence: ScenarioEvidence['coverage']
  native_components: string[]
  message_types: string[]
  witness_seconds: number
}

export interface InverseBlockingEvidence {
  scenario_id: string
  scenario_title: string
  component_id: string
  decision: string
  evidence: ScenarioEvidence['coverage']
  message_types: string[]
}

export interface InverseProfileResult {
  status: 'sat' | 'unsat' | 'unknown'
  reachable: boolean | null
  witness_seconds: number | null
  reached_state: Record<InverseTargetField, number> | null
  witness_inputs: InverseWitnessInput[]
  solver: string
  constraint_count: number
  individually_enabling_scenarios: InverseEnablingScenario[]
  combination_required: boolean
  blocking_evidence: InverseBlockingEvidence[]
}

export interface InverseReachabilityResult {
  schema_version: string
  status: string
  engine: string
  semantics: string
  evidence_boundary: string
  target: InverseTarget
  target_tolerances: Partial<Record<InverseTargetField, { value: number; unit: string }>>
  attack_ids: string[]
  relevant_attack_ids: string[]
  horizon_seconds: number
  step_seconds: number
  profiles: Record<Profile, InverseProfileResult>
}

export interface McaComponent {
  id: string
  name: string
  description?: string
  kind?: string
  role?: string
  binary?: {
    filename?: string
    path?: string
    sha256?: string
    size_bytes?: number
    architecture?: string
  }
  analysis?: {
    completed?: boolean
    max_hook_inputs?: number
    max_bus_messages_per_run?: number
  }
  consumes?: Array<{ id: number; hex: string; name?: string }>
  produces?: Array<{ id: number; hex: string; name?: string }>
}

export interface McaConstraint {
  message_id: number
  producer_component_id: string
  message_type_id: number
  message_type_name?: string
  reachability: string
  payload_expression?: string | null
  variables?: string[]
  predicates?: Array<{ format?: string; text: string; variables?: string[] }>
}

export interface McaEdge {
  id?: string
  source?: string
  target?: string
  source_component_id: string
  target_component_id: string
  message_id: number
  message_type_id?: number
  message_type_name?: string
  reachability?: string
  from_unconstrained_run?: boolean
  constraints?: Array<{ format?: string; text: string; variables?: string[] }>
}

export type McaTraceEntry = [
  messageId: number,
  componentName: string,
  inputMessageIds: number[],
]

export interface McaMessage {
  id: number
  producer_component_id: string
  reachability?: string
  from_unconstrained_run?: boolean
  type?: { id?: number; name?: string; hex?: string }
  data?: {
    kind?: string
    bits?: number
    expression?: string | null
    expression_format?: string | null
    hex?: string | null
    signed_decimal?: string | null
    unsigned_decimal?: string | null
    variables?: string[]
    constraints?: Array<{ format?: string; text: string; variables?: string[] }>
  }
}

export interface McaArtifact {
  format: string
  schema_version: string
  profile: Profile
  generator?: {
    name?: string
    version?: string
    git?: { commit?: string; dirty?: boolean }
    python_version?: string
    angr_version?: string
    claripy_version?: string
  }
  run?: {
    id?: string
    started_at?: string
    finished_at?: string
    duration_seconds?: number
    status?: string
  }
  analysis?: {
    status?: string
    engine?: string
    execution_mode?: string
    completed_real_angr_run?: boolean
    fixed_point_reached?: boolean
    reachability_scope?: string
  }
  provenance?: {
    config_path?: string
    config_sha256?: string
    binary_sha256?: Record<string, string>
  }
  nodes?: McaComponent[]
  components: McaComponent[]
  edges?: McaEdge[]
  communication_edges: McaEdge[]
  constraints: McaConstraint[]
  productions?: Array<{
    id: number
    component_id: string
    output_message_id: number
    input_message_ids: number[]
  }>
  messages?: McaMessage[]
  traces?: Record<string, McaTraceEntry[][]>
  summary: Record<string, number | string[]>
  safety_findings?: Array<{
    id: string
    property: string
    status: string
    reachable_violation_message_ids: number[]
  }>
}
