import type { AircraftState, AttackScenario, FlightPhase, Profile, PropagationStatus, Route, SafetyLimits } from '../types'
import { localOffsetOnRoute, normalizeHeading, routeLength, routePointAtDistance } from './geo'

export interface SimulationContext {
  route: Route
  attacks: AttackScenario[]
  safety: SafetyLimits
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const moveTowards = (value: number, target: number, maxDelta: number): number =>
  value < target ? Math.min(target, value + maxDelta) : Math.max(target, value - maxDelta)

const knotsToMps = (knots: number): number => knots * 0.514444
const knotsToFps = (knots: number): number => knots * 1.68781

/**
 * Absolute plant limits for the research aircraft.
 *
 * These are deliberately wider than the configurable safety predicates: an
 * attack can violate the normal +/-32 degree bank or +/-20 degree pitch
 * envelope without allowing the numerical plant to become an impossible
 * aircraft. The route itself tops out at 12,000 ft; 20,000 ft leaves recovery
 * margin while preventing a stale command from integrating without bound.
 */
export const DEMO_AIRCRAFT_ENVELOPE = {
  maxAltitudeFt: 20_000,
  maxTrueAirspeedKt: 330,
  maxIndicatedAirspeedKt: 400,
  maxGroundSpeedKt: 340,
  maxRollDeg: 55,
  maxPitchDeg: 25,
  maxAngleOfAttackDeg: 12,
  maxYawRateDegS: 10,
  maxFlightPathAngleDeg: 30,
} as const

export function flightPathAngleFromVelocity(verticalSpeedFpm: number, horizontalGroundSpeedKt: number): number {
  if (Math.abs(horizontalGroundSpeedKt) < 1) return 0
  return Math.atan2(verticalSpeedFpm / 60, knotsToFps(horizontalGroundSpeedKt)) * 180 / Math.PI
}

function routeProfileVerticalSpeedFpm(route: Route, alongTrackM: number, speedMps: number): number {
  if (speedMps < 0.1) return 0
  const total = routeLength(route)
  const lookAheadM = Math.min(total, alongTrackM + Math.max(600, speedMps * 20))
  const distanceM = lookAheadM - alongTrackM
  if (distanceM < 1) return 0
  const here = routePointAtDistance(route, alongTrackM)
  const ahead = routePointAtDistance(route, lookAheadM)
  const gradientFtPerM = (ahead.altitudeFt - here.altitudeFt) / distanceM
  return gradientFtPerM * speedMps * 60
}

function flightPhaseFor(
  route: Route,
  time: number,
  alongTrackM: number,
  altitudeFt: number,
  targetAltitudeFt: number,
  profileVerticalSpeedFpm: number,
): FlightPhase {
  const performance = route.performance
  const total = routeLength(route)
  const remainingM = Math.max(0, total - alongTrackM)
  const destinationAltitudeFt = route.points.at(-1)!.altitude_ft
  if (time < performance.takeoff_roll_seconds) return 'GROUND ROLL'
  if (time < performance.takeoff_roll_seconds + 12) return 'ROTATION'
  if (remainingM < 2 && altitudeFt <= destinationAltitudeFt + 30) return 'LANDED'
  if (remainingM < 20_000) return 'APPROACH'
  const altitudeErrorFt = targetAltitudeFt - altitudeFt
  if (profileVerticalSpeedFpm > 300 || altitudeErrorFt > 300) return 'CLIMB'
  if (profileVerticalSpeedFpm < -300 || altitudeErrorFt < -300) return 'DESCENT'
  return 'CRUISE'
}

function targetAirspeedKt(route: Route, phase: FlightPhase): number {
  const performance = route.performance
  switch (phase) {
    case 'GROUND ROLL': return performance.rotate_speed_kt
    case 'ROTATION':
    case 'CLIMB': return performance.climb_speed_kt
    case 'DESCENT': return performance.descent_speed_kt
    case 'APPROACH': return performance.approach_speed_kt
    case 'LANDED': return 0
    default: return route.cruise_speed_kt
  }
}

function targetAngleOfAttackDeg(phase: FlightPhase): number {
  switch (phase) {
    case 'ROTATION': return 8
    case 'CLIMB': return 4
    case 'CRUISE': return 2
    case 'DESCENT': return 2
    case 'APPROACH': return 5
    default: return 0
  }
}

const smoothstep = (value: number): number => value * value * (3 - 2 * value)

function scenarioFlightGateMet(
  scenario: AttackScenario,
  phase: FlightPhase,
  heightAglFt: number,
): boolean {
  const phaseGate = scenario.effect.phase_gate
  if (phaseGate?.length && !phaseGate.includes(phase)) return false
  if (scenario.effect.max_agl_ft != null && heightAglFt > scenario.effect.max_agl_ft) return false
  return true
}

function shapedRamp(value: number, waveform: AttackScenario['effect']['waveform']): number {
  const progress = clamp(value, 0, 1)
  if (waveform === 'step') return progress > 0 || value === 0 ? 1 : 0
  if (waveform === 'smoothstep') return smoothstep(progress)
  return progress
}

/** Return the normalized, causal effect strength for one configured scenario. */
function scenarioEffectStrength(
  scenario: AttackScenario,
  time: number,
  phase: FlightPhase,
  heightAglFt: number,
): number {
  if (!scenarioFlightGateMet(scenario, phase, heightAglFt)) return 0
  const elapsed = time - scenario.activation_seconds
  if (elapsed < 0) return 0

  const { rise_seconds: rise, duration_seconds: duration, fall_seconds: fall, waveform } = scenario.effect
  if (waveform === 'sine_pulse' && duration !== null) {
    const total = rise + duration + fall
    if (total <= 0 || elapsed > total) return 0
    return Math.sin(Math.PI * clamp(elapsed / total, 0, 1))
  }

  if (rise > 0 && elapsed < rise) return shapedRamp(elapsed / rise, waveform)
  if (duration === null) return 1
  const fallStart = rise + duration
  if (elapsed <= fallStart) return 1
  if (fall <= 0 || elapsed >= fallStart + fall) return 0
  const remaining = 1 - (elapsed - fallStart) / fall
  return shapedRamp(remaining, waveform)
}

export function scenarioIsEffective(
  scenario: AttackScenario,
  time: number,
  phase: FlightPhase,
  heightAglFt: number,
): boolean {
  return scenarioEffectStrength(scenario, time, phase, heightAglFt) > 1e-9
}

const scenarioById = (attacks: AttackScenario[], id: string): AttackScenario | undefined =>
  attacks.find((attack) => attack.id === id)

function scenarioStrengthById(
  attacks: AttackScenario[],
  id: string,
  time: number,
  phase: FlightPhase,
  heightAglFt: number,
): number {
  const scenario = scenarioById(attacks, id)
  return scenario ? scenarioEffectStrength(scenario, time, phase, heightAglFt) : 0
}

function activeMagnitude(
  attacks: AttackScenario[],
  key: keyof AttackScenario['magnitude'],
  time: number,
  phase: FlightPhase,
  heightAglFt: number,
): number {
  return attacks.reduce((total, scenario) => (
    total + (scenario.magnitude[key] ?? 0) * scenarioEffectStrength(scenario, time, phase, heightAglFt)
  ), 0)
}

const median3 = (first: number, second: number, third: number): number =>
  [first, second, third].sort((left, right) => left - right)[1]

export function classifySafety(state: Omit<AircraftState, 'safetyViolations'> | AircraftState, safety: SafetyLimits): string[] {
  const violations: string[] = []
  if (Math.abs(state.rollDeg) > safety.max_roll_deg) violations.push('ROLL')
  if (Math.abs(state.pitchDeg) > safety.max_pitch_deg) violations.push('PITCH')
  if (Math.abs(state.yawRateDegS) > safety.max_yaw_rate_deg_s) violations.push('YAW RATE')
  if (Math.abs(state.crossTrackM) > safety.max_course_deviation_nm * 1852) violations.push('COURSE')
  if (Math.abs(state.altitudeFt - state.targetAltitudeFt) > safety.max_altitude_deviation_ft) violations.push('ALTITUDE')
  return violations
}

export function initialAircraftState(profile: Profile, context: SimulationContext): AircraftState {
  const point = routePointAtDistance(context.route, 0)
  const base: Omit<AircraftState, 'safetyViolations'> = {
    time: 0,
    truePosition: point,
    estimatedPosition: point,
    commandedPosition: point,
    altitudeFt: point.altitudeFt,
    estimatedAltitudeFt: point.altitudeFt,
    targetAltitudeFt: point.altitudeFt,
    commandedAltitudeFt: point.altitudeFt,
    rollDeg: 0,
    pitchDeg: 0,
    angleOfAttackDeg: 0,
    flightPathAngleDeg: 0,
    headingDeg: point.headingDeg,
    yawRateDegS: 0,
    commandedRollDeg: 0,
    commandedPitchDeg: 0,
    crossTrackM: 0,
    estimatedCrossTrackM: 0,
    targetCrossTrackM: 0,
    alongTrackM: 0,
    airspeedKt: 0,
    indicatedAirspeedKt: 0,
    groundSpeedKt: 0,
    verticalSpeedFpm: 0,
    flightPhase: 'GROUND ROLL',
    navMode: profile === 'secure' ? 'MULTI-SENSOR NAV' : 'GNSS PRIMARY',
    source: profile === 'secure' ? 'GNSS · IRS · DME vote' : 'GNSS 1',
    busHealth: 'nominal',
  }
  return { ...base, safetyViolations: classifySafety(base, context.safety) }
}

export function advanceAircraft(
  previous: AircraftState,
  profile: Profile,
  context: SimulationContext,
  dtSeconds: number,
): AircraftState {
  const dt = clamp(dtSeconds, 0.01, 2)
  const time = previous.time + dt
  const route = context.route
  const performance = route.performance
  const totalRouteM = routeLength(route)
  const previousPlanned = routePointAtDistance(route, previous.alongTrackM)
  const preliminaryProfileVsFpm = routeProfileVerticalSpeedFpm(route, previous.alongTrackM, knotsToMps(Math.max(previous.airspeedKt, performance.rotate_speed_kt)))
  const preliminaryPhase = flightPhaseFor(
    route,
    time,
    previous.alongTrackM,
    previous.altitudeFt,
    previousPlanned.altitudeFt,
    preliminaryProfileVsFpm,
  )
  const desiredAirspeedKt = targetAirspeedKt(route, preliminaryPhase)
  const accelerationKtS = preliminaryPhase === 'GROUND ROLL'
    ? performance.rotate_speed_kt / performance.takeoff_roll_seconds
    : desiredAirspeedKt >= previous.airspeedKt ? 1.8 : 2.5
  const airspeedKt = clamp(
    moveTowards(previous.airspeedKt, desiredAirspeedKt, accelerationKtS * dt),
    0,
    DEMO_AIRCRAFT_ENVELOPE.maxTrueAirspeedKt,
  )
  let groundSpeedKt = airspeedKt
  const speedMps = knotsToMps((previous.groundSpeedKt + groundSpeedKt) / 2)
  const previousRouteDelta = normalizeHeading(previous.headingDeg - previousPlanned.headingDeg)
  const previousRouteErrorDeg = previousRouteDelta > 180 ? previousRouteDelta - 360 : previousRouteDelta
  const routeTangentSpeedMps = Math.max(0, speedMps * Math.cos(clamp(previousRouteErrorDeg, -89, 89) * Math.PI / 180))
  const alongTrackM = Math.min(totalRouteM, previous.alongTrackM + routeTangentSpeedMps * dt)
  const planned = routePointAtDistance(route, alongTrackM)
  const profileVerticalSpeedFpm = routeProfileVerticalSpeedFpm(route, alongTrackM, knotsToMps(groundSpeedKt))
  const phase = flightPhaseFor(route, time, alongTrackM, previous.altitudeFt, planned.altitudeFt, profileVerticalSpeedFpm)
  const isSecure = profile === 'secure'
  const destinationAltitudeFt = route.points.at(-1)!.altitude_ft
  const heightAglFt = Math.max(0, previous.altitudeFt - destinationAltitudeFt)

  const gpsBiasM = activeMagnitude(context.attacks, 'gps_bias_m', time, phase, heightAglFt)
  const radioBiasM = activeMagnitude(context.attacks, 'radio_bias_m', time, phase, heightAglFt)
  const rawRouteOffsetM = activeMagnitude(context.attacks, 'route_offset_m', time, phase, heightAglFt)
  const injectedRollDeg = activeMagnitude(context.attacks, 'roll_injection_deg', time, phase, heightAglFt)
  const navOutputBiasM = activeMagnitude(context.attacks, 'nav_output_bias_m', time, phase, heightAglFt)
  const fmsSteeringDropout = activeMagnitude(context.attacks, 'fms_steering_dropout', time, phase, heightAglFt)
  const navigationLoss = activeMagnitude(context.attacks, 'navigation_loss', time, phase, heightAglFt)
  const mcduAltitudeOffsetFt = activeMagnitude(context.attacks, 'mcdu_altitude_offset_ft', time, phase, heightAglFt)
  const radioAltimeterLoss = activeMagnitude(context.attacks, 'radio_altimeter_loss', time, phase, heightAglFt)
  const airspeedBiasKt = activeMagnitude(context.attacks, 'airspeed_bias_kt', time, phase, heightAglFt)
  const crosswindMps = activeMagnitude(context.attacks, 'crosswind_mps', time, phase, heightAglFt)
  const verticalGustMps = activeMagnitude(context.attacks, 'vertical_gust_mps', time, phase, heightAglFt)

  const degradedStrength = scenarioStrengthById(context.attacks, 'gnss_degraded_mode', time, phase, heightAglFt)
  const coherentSpoofStrength = scenarioStrengthById(context.attacks, 'coherent_nav_spoof', time, phase, heightAglFt)
  const navOutputTamperStrength = scenarioStrengthById(context.attacks, 'nav_output_tamper', time, phase, heightAglFt)
  const mapTamperStrength = scenarioStrengthById(context.attacks, 'efb_map_tamper', time, phase, heightAglFt)
  const busInjectionStrength = scenarioStrengthById(context.attacks, 'afdx_injection', time, phase, heightAglFt)
  const fmsDosStrength = scenarioStrengthById(context.attacks, 'fms_steering_dos', time, phase, heightAglFt)
  const totalNavLossStrength = scenarioStrengthById(context.attacks, 'total_nav_loss', time, phase, heightAglFt)
  const mcduTamperStrength = scenarioStrengthById(context.attacks, 'mcdu_altitude_tamper', time, phase, heightAglFt)
  const radioAltStrength = scenarioStrengthById(context.attacks, 'radio_altimeter_fault', time, phase, heightAglFt)
  const convectiveStrength = scenarioStrengthById(context.attacks, 'convective_gust', time, phase, heightAglFt)
  const spoofActive = Math.abs(gpsBiasM) > 1e-9

  // Measurement corruption is applied at the sensor first. Secure navigation
  // uses the median of three independent sources and explicit monitors for the
  // two attacks that corrupt a majority or the post-fusion output. Vulnerable
  // navigation grants the GNSS/post-fusion value authority.
  const insResidualM = 14 * Math.sin(time / 19) + degradedStrength * 35 * Math.sin(time / 7)
  const radioResidualM = 9 * Math.sin(time / 13 + 0.7)
  const gnssMeasurementM = previous.crossTrackM + gpsBiasM
  const insMeasurementM = previous.crossTrackM + insResidualM
  const radioMeasurementM = previous.crossTrackM + radioResidualM + radioBiasM
  let estimatedCrossTrackM = isSecure
    ? median3(gnssMeasurementM, insMeasurementM, radioMeasurementM)
    : gnssMeasurementM

  if (isSecure && (degradedStrength > 0 || coherentSpoofStrength > 0 || navOutputTamperStrength > 0)) {
    estimatedCrossTrackM = insMeasurementM
  } else if (!isSecure && Math.abs(navOutputBiasM) > 0) {
    estimatedCrossTrackM += navOutputBiasM
  }
  const navigationLossLevel = clamp(Math.abs(navigationLoss), 0, 1)
  if (totalNavLossStrength > 0 && navigationLossLevel > 0) {
    const reversionEstimate = isSecure
      ? previous.crossTrackM + 20 * Math.sin(time / 23)
      : previous.estimatedCrossTrackM
    estimatedCrossTrackM = estimatedCrossTrackM * (1 - navigationLossLevel) + reversionEstimate * navigationLossLevel
  }

  const routeOffsetM = isSecure ? 0 : rawRouteOffsetM
  const targetCrossTrackM = routeOffsetM

  const navigationErrorM = estimatedCrossTrackM - targetCrossTrackM
  const priorHeadingDelta = normalizeHeading(previous.headingDeg - planned.headingDeg)
  const priorHeadingErrorDeg = priorHeadingDelta > 180 ? priorHeadingDelta - 360 : priorHeadingDelta
  // Lateral guidance combines position and track-angle feedback. Position-only
  // control would create an undamped weaving mode rather than a plausible FMS
  // intercept and capture.
  const nominalYawDamperRateDegS = 2.8
  const nominalBankLimitDeg = Math.min(
    32,
    Math.atan((nominalYawDamperRateDegS * Math.PI / 180) * Math.max(knotsToMps(airspeedKt), knotsToMps(80)) / 9.80665) * 180 / Math.PI,
  )
  let rollCommand = clamp(-0.012 * navigationErrorM - 0.72 * priorHeadingErrorDeg, -nominalBankLimitDeg, nominalBankLimitDeg)
  if (isSecure && convectiveStrength > 0) {
    // Weather/air-data feed-forward establishes the crab correction before a
    // large cross-track residual develops; the baseline controller is reactive.
    rollCommand = clamp(rollCommand - 0.45 * crosswindMps, -nominalBankLimitDeg, nominalBankLimitDeg)
  }
  const steeringDropoutLevel = clamp(Math.abs(fmsSteeringDropout), 0, 1)
  if (fmsDosStrength > 0 && steeringDropoutLevel > 0) {
    const fallbackRollCommand = isSecure
      ? clamp(-0.72 * priorHeadingErrorDeg, -12, 12)
      : previous.commandedRollDeg
    rollCommand = rollCommand * (1 - steeringDropoutLevel) + fallbackRollCommand * steeringDropoutLevel
  }
  if (totalNavLossStrength > 0 && navigationLossLevel > 0) {
    const lossRollCommand = isSecure
      ? clamp(-0.72 * priorHeadingErrorDeg, -12, 12)
      : previous.commandedRollDeg
    rollCommand = rollCommand * (1 - navigationLossLevel) + lossRollCommand * navigationLossLevel
  }
  if (busInjectionStrength > 0 && !isSecure) rollCommand = clamp(injectedRollDeg, -55, 55)
  if (isSecure) rollCommand = clamp(rollCommand, -32, 32)
  rollCommand = clamp(
    rollCommand,
    -DEMO_AIRCRAFT_ENVELOPE.maxRollDeg,
    DEMO_AIRCRAFT_ENVELOPE.maxRollDeg,
  )
  if (phase === 'GROUND ROLL') rollCommand = 0

  const targetAltitudeFt = clamp(
    phase === 'GROUND ROLL' ? route.points[0].altitude_ft : planned.altitudeFt,
    0,
    DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt,
  )
  const commandedAltitudeFt = clamp(
    targetAltitudeFt + (isSecure ? 0 : mcduAltitudeOffsetFt),
    0,
    DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt,
  )
  const altitudeErrorFt = commandedAltitudeFt - previous.altitudeFt
  let commandedVerticalSpeedFpm = clamp(
    profileVerticalSpeedFpm + 1.2 * altitudeErrorFt,
    -performance.max_descent_fpm,
    performance.max_climb_fpm,
  )
  if (phase === 'GROUND ROLL' || phase === 'LANDED') commandedVerticalSpeedFpm = 0
  if (phase === 'ROTATION') commandedVerticalSpeedFpm = Math.max(commandedVerticalSpeedFpm, Math.min(2_200, performance.max_climb_fpm))
  const trueAirspeedFps = Math.max(knotsToFps(airspeedKt), knotsToFps(80))
  const targetAngleOfAttack = targetAngleOfAttackDeg(phase)
  const flightPathCommandDeg = Math.asin(clamp((commandedVerticalSpeedFpm / 60) / trueAirspeedFps, -0.48, 0.48)) * 180 / Math.PI
  let pitchCommand = flightPathCommandDeg + targetAngleOfAttack
  if (!isSecure && fmsDosStrength > 0 && steeringDropoutLevel > 0) {
    pitchCommand = pitchCommand * (1 - steeringDropoutLevel) + previous.commandedPitchDeg * steeringDropoutLevel
  }
  if (!isSecure && totalNavLossStrength > 0 && navigationLossLevel > 0) {
    pitchCommand = pitchCommand * (1 - navigationLossLevel) + previous.commandedPitchDeg * navigationLossLevel
  }
  if (isSecure) pitchCommand = clamp(pitchCommand, -18, 18)
  pitchCommand = clamp(
    pitchCommand,
    -DEMO_AIRCRAFT_ENVELOPE.maxPitchDeg,
    DEMO_AIRCRAFT_ENVELOPE.maxPitchDeg,
  )

  // Nominal control-law dynamics are identical. Profile differences above are
  // tied to an explicit monitor, voter, or envelope decision.
  const responseTime = 3.5
  const response = 1 - Math.exp(-dt / responseTime)
  const rollDeg = phase === 'GROUND ROLL'
    ? 0
    : clamp(
        previous.rollDeg + response * (rollCommand - previous.rollDeg),
        -DEMO_AIRCRAFT_ENVELOPE.maxRollDeg,
        DEMO_AIRCRAFT_ENVELOPE.maxRollDeg,
      )
  let pitchDeg = phase === 'GROUND ROLL'
    ? 0
    : clamp(
        previous.pitchDeg + response * (pitchCommand - previous.pitchDeg),
        -DEMO_AIRCRAFT_ENVELOPE.maxPitchDeg,
        DEMO_AIRCRAFT_ENVELOPE.maxPitchDeg,
      )
  let angleOfAttackDeg = phase === 'GROUND ROLL' || phase === 'LANDED'
    ? 0
    : clamp(
        previous.angleOfAttackDeg + response * (targetAngleOfAttack - previous.angleOfAttackDeg),
        0,
        DEMO_AIRCRAFT_ENVELOPE.maxAngleOfAttackDeg,
      )
  const airRelativeFlightPathAngleDeg = pitchDeg - angleOfAttackDeg
  groundSpeedKt = phase === 'GROUND ROLL'
    ? airspeedKt
    : clamp(
        airspeedKt * Math.cos(airRelativeFlightPathAngleDeg * Math.PI / 180),
        0,
        DEMO_AIRCRAFT_ENVELOPE.maxGroundSpeedKt,
      )
  const coordinatedYawRateDegS = phase === 'GROUND ROLL'
    ? 0
    : 9.80665 * Math.tan(rollDeg * Math.PI / 180) / Math.max(knotsToMps(airspeedKt), knotsToMps(80)) * 180 / Math.PI
  const yawRateDegS = clamp(
    coordinatedYawRateDegS,
    -DEMO_AIRCRAFT_ENVELOPE.maxYawRateDegS,
    DEMO_AIRCRAFT_ENVELOPE.maxYawRateDegS,
  )
  const plannedHeadingError = normalizeHeading(previous.headingDeg - planned.headingDeg)
  const signedHeadingError = plannedHeadingError > 180 ? plannedHeadingError - 360 : plannedHeadingError
  const headingErrorDeg = clamp(signedHeadingError + yawRateDegS * dt, -75, 75)
  const headingDeg = normalizeHeading(planned.headingDeg + headingErrorDeg)

  const convective = scenarioById(context.attacks, 'convective_gust')
  const convectiveElapsed = convective ? Math.max(0, time - convective.activation_seconds) : 0
  const wind = crosswindMps
  const verticalGustFps = verticalGustMps * Math.sin(convectiveElapsed * 0.43) / 0.3048
  const crossTrackM = previous.crossTrackM + (speedMps * Math.sin(headingErrorDeg * Math.PI / 180) + (phase === 'GROUND ROLL' ? 0 : wind)) * dt
  const unconstrainedVerticalSpeedFpm = phase === 'GROUND ROLL' || phase === 'LANDED'
    ? 0
    : (knotsToFps(airspeedKt) * Math.sin(airRelativeFlightPathAngleDeg * Math.PI / 180) + verticalGustFps) * 60
  let verticalSpeedFpm = clamp(
    unconstrainedVerticalSpeedFpm,
    -performance.max_descent_fpm,
    performance.max_climb_fpm,
  )
  let verticalRateLimited = Math.abs(verticalSpeedFpm - unconstrainedVerticalSpeedFpm) > 1e-9
  let flightPathAngleDeg = phase === 'GROUND ROLL' || phase === 'LANDED'
    ? 0
    : clamp(
        flightPathAngleFromVelocity(verticalSpeedFpm, groundSpeedKt),
        -DEMO_AIRCRAFT_ENVELOPE.maxFlightPathAngleDeg,
        DEMO_AIRCRAFT_ENVELOPE.maxFlightPathAngleDeg,
      )
  const rawAltitudeFt = phase === 'GROUND ROLL'
    ? route.points[0].altitude_ft
    : previous.altitudeFt + verticalSpeedFpm / 60 * dt
  const remainingRouteM = totalRouteM - alongTrackM
  const altitudeFloorFt = remainingRouteM < 1_000 ? destinationAltitudeFt : 0
  let altitudeFt = clamp(
    rawAltitudeFt,
    altitudeFloorFt,
    DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt,
  )
  if (Math.abs(altitudeFt - rawAltitudeFt) > 1e-9 && phase !== 'GROUND ROLL') {
    verticalRateLimited = true
    verticalSpeedFpm = (altitudeFt - previous.altitudeFt) * 60 / dt
    flightPathAngleDeg = clamp(
      flightPathAngleFromVelocity(verticalSpeedFpm, groundSpeedKt),
      -DEMO_AIRCRAFT_ENVELOPE.maxFlightPathAngleDeg,
      DEMO_AIRCRAFT_ENVELOPE.maxFlightPathAngleDeg,
    )
  }
  if (verticalRateLimited && phase !== 'GROUND ROLL' && phase !== 'LANDED') {
    // The energy/rate limiter changes the achieved flight path, so pitch must
    // follow the limited trajectory rather than retaining an impossible climb
    // angle that would integrate through the ceiling on the next step.
    pitchDeg = clamp(
      flightPathAngleDeg + angleOfAttackDeg,
      -DEMO_AIRCRAFT_ENVELOPE.maxPitchDeg,
      DEMO_AIRCRAFT_ENVELOPE.maxPitchDeg,
    )
  }
  let flightPhase = flightPhaseFor(route, time, alongTrackM, altitudeFt, planned.altitudeFt, profileVerticalSpeedFpm)
  if (flightPhase === 'LANDED') {
    altitudeFt = destinationAltitudeFt
    verticalSpeedFpm = 0
    pitchDeg = 0
    pitchCommand = 0
    angleOfAttackDeg = 0
    flightPathAngleDeg = 0
  }
  // Radio-height loss changes approach-system availability only. It never
  // fabricates a barometric altitude or pitch command in this plant.
  const estimatedAltitudeFt = clamp(
    altitudeFt + (isSecure ? 4 * Math.sin(time / 5) : 0),
    0,
    DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt,
  )
  const indicatedAirspeedKt = clamp(
    airspeedKt + (isSecure ? 0 : airspeedBiasKt),
    0,
    DEMO_AIRCRAFT_ENVELOPE.maxIndicatedAirspeedKt,
  )

  let navMode = isSecure ? 'MULTI-SENSOR NAV' : 'GNSS PRIMARY'
  let source = isSecure ? 'GNSS · IRS · DME vote' : 'GNSS 1'
  let busHealth: AircraftState['busHealth'] = 'nominal'
  if (degradedStrength > 0) {
    navMode = isSecure ? 'GEOGRAPHIC HOLD' : 'GNSS ONLY'
    source = isSecure ? 'independent route monitor' : 'unvoted GNSS 1'
    busHealth = 'degraded'
  }
  if (spoofActive) {
    navMode = isSecure ? 'GNSS REJECTED' : 'GNSS TRACK'
    source = isSecure ? 'IRS · DME concordant pair' : 'spoofed GNSS fix'
    busHealth = isSecure ? 'degraded' : 'compromised'
  }
  if (coherentSpoofStrength > 0) {
    navMode = isSecure ? 'COHERENT SPOOF REJECTED' : 'CORRELATED FALSE FIX'
    source = isSecure ? 'independent route monitor' : 'spoofed GNSS + radio pair'
    busHealth = isSecure ? 'degraded' : 'compromised'
  }
  if (navOutputTamperStrength > 0) {
    navMode = isSecure ? 'FMS POSITION REJECTED' : 'CORRUPTED NAV OUTPUT'
    source = isSecure ? 'independent route monitor' : 'tampered fused solution'
    busHealth = isSecure ? 'degraded' : 'compromised'
  }
  if (mapTamperStrength > 0) {
    navMode = isSecure ? 'SIGNED ROUTE HOLD' : 'MODIFIED LEG ACTIVE'
    source = isSecure ? 'verified flight-plan store' : 'unsigned EFB/DLS route'
    busHealth = isSecure ? 'degraded' : 'compromised'
  }
  if (busInjectionStrength > 0) {
    navMode = isSecure ? 'VL FRAME REJECTED' : 'NAV DIRECT'
    source = isSecure ? 'AFDX allow-list + envelope' : 'forged AFDX command'
    busHealth = isSecure ? 'degraded' : 'compromised'
  }
  if (fmsDosStrength > 0) {
    navMode = isSecure ? 'MONITORED HDG REVERSION' : 'STALE FMS STEERING'
    source = isSecure ? 'flight-guidance monitor' : 'last accepted FMS command'
    busHealth = isSecure ? 'degraded' : 'compromised'
  }
  if (totalNavLossStrength > 0) {
    navMode = isSecure ? 'MONITORED ATTITUDE REVERSION' : 'STALE ATTITUDE HOLD'
    source = isSecure ? 'inertial attitude + stored track' : 'stale navigation state'
    busHealth = 'degraded'
  }
  if (mcduTamperStrength > 0) {
    navMode = isSecure ? 'MCDU CHANGE REJECTED' : 'MCDU ALTITUDE ACTIVE'
    source = isSecure ? 'validated vertical flight plan' : 'unauthorized crew-interface target'
    busHealth = isSecure ? 'degraded' : 'compromised'
  }
  if (radioAltStrength > 0 && radioAltimeterLoss > 0) {
    navMode = isSecure ? 'APPROACH SENSOR REVERSION' : 'APPROACH STATE STALE'
    source = isSecure ? 'radio altimeter 2 selected' : 'stale radio-height word'
    busHealth = 'degraded'
  }
  if (convectiveStrength > 0) {
    source = isSecure ? 'weather radar + air data' : 'air data in convective field'
  }

  const truePosition = localOffsetOnRoute(route, alongTrackM, crossTrackM)
  const estimatedPosition = localOffsetOnRoute(route, alongTrackM, estimatedCrossTrackM)
  const commandedPosition = localOffsetOnRoute(route, alongTrackM, targetCrossTrackM)
  const base: Omit<AircraftState, 'safetyViolations'> = {
    time,
    truePosition,
    estimatedPosition,
    commandedPosition,
    altitudeFt,
    estimatedAltitudeFt,
    targetAltitudeFt,
    commandedAltitudeFt,
    rollDeg,
    pitchDeg,
    angleOfAttackDeg,
    flightPathAngleDeg,
    headingDeg,
    yawRateDegS,
    commandedRollDeg: rollCommand,
    commandedPitchDeg: pitchCommand,
    crossTrackM,
    estimatedCrossTrackM,
    targetCrossTrackM,
    alongTrackM,
    airspeedKt,
    indicatedAirspeedKt,
    groundSpeedKt,
    verticalSpeedFpm,
    flightPhase,
    navMode,
    source,
    busHealth,
  }
  return { ...base, safetyViolations: classifySafety(base, context.safety) }
}

export function advanceAircraftForDuration(
  previous: AircraftState,
  profile: Profile,
  context: SimulationContext,
  durationSeconds: number,
): AircraftState {
  let state = previous
  let remaining = Math.max(0, durationSeconds)
  // High playback rates remain physically identical to normal speed: the UI
  // accelerates wall clock, not the integration step used by the plant.
  while (remaining > 1e-9) {
    const step = Math.min(1, remaining)
    state = advanceAircraft(state, profile, context, step)
    remaining -= step
  }
  return state
}

export function propagationStatus(
  profile: Profile,
  scenario: AttackScenario,
  stepIndex: number,
  time: number,
  phase: FlightPhase,
  heightAglFt: number,
): PropagationStatus {
  const step = scenario.steps[stepIndex]
  if (time < step.at_seconds) return 'dormant'
  const dependenciesReady = (step.depends_on ?? []).every((dependencyId) => {
    const dependency = scenario.steps.find((candidate) => candidate.id === dependencyId)
    return Boolean(dependency && time >= dependency.at_seconds)
  })
  if (!dependenciesReady) return 'dormant'
  if ((step.kind === 'decision' || step.kind === 'effect') && !scenarioFlightGateMet(scenario, phase, heightAglFt)) {
    return 'armed'
  }
  return profile === 'secure' ? step.secure_status : step.vulnerable_status
}
