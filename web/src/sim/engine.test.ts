import { describe, expect, it } from 'vitest'
import { fallbackConfig } from '../data/fallback'
import { advanceAircraft, advanceAircraftForDuration, DEMO_AIRCRAFT_ENVELOPE, flightPathAngleFromVelocity, initialAircraftState, propagationStatus, scenarioIsEffective, type SimulationContext } from './engine'
import type { AttackScenario } from '../types'
import { haversineMeters, initialBearing, routeLength, routePointAtDistance } from './geo'

const run = (profile: 'secure' | 'vulnerable', attackIds: string[], seconds = 125) => {
  const context: SimulationContext = {
    route: fallbackConfig.routes[0],
    attacks: fallbackConfig.attacks.filter((attack) => attackIds.includes(attack.id)),
    safety: fallbackConfig.safety_defaults,
  }
  let state = initialAircraftState(profile, context)
  for (let index = 0; index < seconds; index += 1) state = advanceAircraft(state, profile, context, 1)
  return state
}

const trace = (profile: 'secure' | 'vulnerable', attackIds: string[], seconds = 1500) => {
  const context: SimulationContext = {
    route: fallbackConfig.routes[0],
    attacks: fallbackConfig.attacks.filter((attack) => attackIds.includes(attack.id)),
    safety: fallbackConfig.safety_defaults,
  }
  const states = [initialAircraftState(profile, context)]
  for (let index = 0; index < seconds; index += 1) states.push(advanceAircraft(states.at(-1)!, profile, context, 1))
  return states
}

const scenario = (id: string): AttackScenario => {
  const result = fallbackConfig.attacks.find((candidate) => candidate.id === id)
  if (!result) throw new Error(`Missing scenario ${id}`)
  return result
}

describe('deterministic aircraft simulation', () => {
  it('evaluates causal rise, hold, fall, phase, and AGL gates', () => {
    const base = scenario('gnss_spoof')
    const pulse: AttackScenario = {
      ...base,
      activation_seconds: 10,
      effect: {
        ...base.effect,
        trigger: 'elapsed_time_and_phase',
        phase_gate: ['APPROACH'],
        max_agl_ft: 2500,
        rise_seconds: 10,
        duration_seconds: 5,
        fall_seconds: 10,
        waveform: 'linear',
      },
    }

    expect(scenarioIsEffective(pulse, 20, 'CRUISE', 1000)).toBe(false)
    expect(scenarioIsEffective(pulse, 20, 'APPROACH', 3000)).toBe(false)
    expect(scenarioIsEffective(pulse, 10, 'APPROACH', 1000)).toBe(false)
    expect(scenarioIsEffective(pulse, 15, 'APPROACH', 1000)).toBe(true)
    expect(scenarioIsEffective(pulse, 25, 'APPROACH', 1000)).toBe(true)
    expect(scenarioIsEffective(pulse, 34.9, 'APPROACH', 1000)).toBe(true)
    expect(scenarioIsEffective(pulse, 35, 'APPROACH', 1000)).toBe(false)
  })

  it('uses configured per-profile propagation outcomes and arms flight-gated effects', () => {
    const base = scenario('radio_altimeter_fault')
    const effectIndex = base.steps.findIndex((step) => step.kind === 'effect')
    const step = base.steps[effectIndex]
    const elapsedTime = Math.max(step.at_seconds, base.activation_seconds) + 1

    expect(propagationStatus('secure', base, effectIndex, elapsedTime, 'CRUISE', 1000)).toBe('armed')
    expect(propagationStatus('vulnerable', base, effectIndex, elapsedTime, 'APPROACH', 1000)).toBe(step.vulnerable_status)
    expect(propagationStatus('secure', base, effectIndex, elapsedTime, 'APPROACH', 1000)).toBe(step.secure_status)
  })

  it('produces identical results for identical inputs', () => {
    expect(run('vulnerable', ['gnss_spoof'])).toEqual(run('vulnerable', ['gnss_spoof']))
  })

  it('secure voting contains GNSS spoof while vulnerable guidance diverges', () => {
    const secure = run('secure', ['gnss_spoof'], 160)
    const vulnerable = run('vulnerable', ['gnss_spoof'], 160)
    expect(Math.abs(secure.crossTrackM)).toBeLessThan(1852)
    expect(Math.abs(vulnerable.crossTrackM)).toBeGreaterThan(1000)
    expect(secure.navMode).toBe('GNSS REJECTED')
    expect(vulnerable.busHealth).toBe('compromised')
  })

  it('rejects a coherent external pair with the independent monitor while baseline fusion diverts', () => {
    const secure = trace('secure', ['coherent_nav_spoof'], 420)
    const vulnerable = trace('vulnerable', ['coherent_nav_spoof'], 420)
    expect(secure.some((state) => state.navMode === 'COHERENT SPOOF REJECTED')).toBe(true)
    expect(vulnerable.some((state) => state.navMode === 'CORRELATED FALSE FIX')).toBe(true)
    expect(Math.max(...secure.map((state) => Math.abs(state.crossTrackM)))).toBeLessThan(1852)
    expect(Math.max(...vulnerable.map((state) => Math.abs(state.crossTrackM)))).toBeGreaterThan(1852)
  })

  it('rejects post-fusion navigation output from an unauthorized publisher', () => {
    const secure = trace('secure', ['nav_output_tamper'], 420)
    const vulnerable = trace('vulnerable', ['nav_output_tamper'], 420)
    expect(secure.some((state) => state.navMode === 'FMS POSITION REJECTED')).toBe(true)
    expect(vulnerable.some((state) => state.navMode === 'CORRUPTED NAV OUTPUT')).toBe(true)
    expect(Math.max(...secure.map((state) => Math.abs(state.crossTrackM)))).toBeLessThan(1852)
    expect(Math.max(...vulnerable.map((state) => Math.abs(state.crossTrackM)))).toBeGreaterThan(1852)
  })

  it('holds stale FMS steering only for the configured finite dropout window', () => {
    const secure = trace('secure', ['fms_steering_dos'], 260)
    const vulnerable = trace('vulnerable', ['fms_steering_dos'], 260)
    const stale = vulnerable.filter((state) => state.navMode === 'STALE FMS STEERING')
    expect(stale.length).toBeGreaterThan(30)
    expect(new Set(stale.slice(2).map((state) => state.commandedRollDeg.toFixed(10))).size).toBe(1)
    expect(secure.some((state) => state.navMode === 'MONITORED HDG REVERSION')).toBe(true)
    expect(vulnerable.at(-1)!.navMode).not.toBe('STALE FMS STEERING')
    expect(secure.at(-1)!.navMode).not.toBe('MONITORED HDG REVERSION')
  })

  it('models finite total navigation loss as monitored reversion versus stale-state drift', () => {
    const secure = trace('secure', ['total_nav_loss'], 280)
    const vulnerable = trace('vulnerable', ['total_nav_loss'], 280)
    const stale = vulnerable.filter((state) => state.navMode === 'STALE ATTITUDE HOLD')
    expect(stale.length).toBeGreaterThan(40)
    expect(stale.at(-1)!.estimatedCrossTrackM).toBeCloseTo(stale[0].estimatedCrossTrackM, 10)
    expect(new Set(stale.slice(2).map((state) => state.commandedRollDeg.toFixed(10))).size).toBe(1)
    expect(Math.abs(stale.at(-1)!.crossTrackM - stale[0].crossTrackM)).toBeGreaterThan(25)
    expect(secure.some((state) => state.navMode === 'MONITORED ATTITUDE REVERSION')).toBe(true)
    expect(vulnerable.at(-1)!.navMode).not.toBe('STALE ATTITUDE HOLD')
  })

  it('keeps the cleared altitude target separate from a tampered MCDU command', () => {
    const secure = trace('secure', ['mcdu_altitude_tamper'], 420)
    const vulnerable = trace('vulnerable', ['mcdu_altitude_tamper'], 420)
    const attacked = vulnerable.find((state) => state.navMode === 'MCDU ALTITUDE ACTIVE' && Math.abs(state.commandedAltitudeFt - state.targetAltitudeFt) > 2400)
    expect(attacked).toBeDefined()
    expect(attacked!.commandedAltitudeFt - attacked!.targetAltitudeFt).toBe(scenario('mcdu_altitude_tamper').magnitude.mcdu_altitude_offset_ft)
    expect(secure.every((state) => state.commandedAltitudeFt === state.targetAltitudeFt)).toBe(true)
    expect(vulnerable.some((state) => state.safetyViolations.includes('ALTITUDE'))).toBe(true)
  })

  it('applies and clears the finite convective disturbance before track recovery', () => {
    const secure = trace('secure', ['convective_gust'], 260)
    const vulnerable = trace('vulnerable', ['convective_gust'], 260)
    const active = vulnerable.filter((state) => state.source === 'air data in convective field')
    expect(active.length).toBeGreaterThan(50)
    expect(vulnerable[129].source).toBe('GNSS 1')
    const securePeak = Math.max(...secure.map((state) => Math.abs(state.crossTrackM)))
    const vulnerablePeak = Math.max(...vulnerable.map((state) => Math.abs(state.crossTrackM)))
    expect(vulnerablePeak).toBeGreaterThan(securePeak)
    expect(Math.abs(vulnerable.at(-1)!.crossTrackM)).toBeLessThan(vulnerablePeak)
  })

  it('secure envelope rejects AFDX injection and vulnerable ship overbanks', () => {
    const secure = trace('secure', ['afdx_injection'])
    const vulnerable = trace('vulnerable', ['afdx_injection'])
    expect(Math.max(...secure.map((state) => Math.abs(state.rollDeg)))).toBeLessThan(32)
    expect(Math.max(...vulnerable.map((state) => Math.abs(state.rollDeg)))).toBeGreaterThan(32)
    expect(vulnerable.some((state) => state.safetyViolations.includes('ROLL'))).toBe(true)
    expect(vulnerable.some((state) => state.navMode === 'NAV DIRECT')).toBe(true)
    expect(vulnerable.at(-1)!.navMode).not.toBe('NAV DIRECT')
  })

  it('uses true, estimated, and commanded states independently', () => {
    const state = trace('vulnerable', ['efb_map_tamper']).reduce((maximum, candidate) => (
      Math.abs(candidate.targetCrossTrackM) > Math.abs(maximum.targetCrossTrackM) ? candidate : maximum
    ))
    expect(state.targetCrossTrackM).toBe(scenario('efb_map_tamper').magnitude.route_offset_m)
    expect(state.commandedPosition).not.toEqual(state.truePosition)
    expect(state.estimatedPosition).not.toEqual(state.commandedPosition)
  })

  it('performs a visible takeoff, climb, cruise, descent, and landing', () => {
    const route = fallbackConfig.routes[0]
    const initial = run('secure', [], 0)
    const groundRoll = run('secure', [], 20)
    const rotation = run('secure', [], 30)
    const climb = run('secure', [], 60)
    const cruise = run('secure', [], 600)
    const descent = run('secure', [], 800)
    const landed = run('secure', [], 1500)

    expect(initial.flightPhase).toBe('GROUND ROLL')
    expect(initial.airspeedKt).toBe(0)
    expect(initial.indicatedAirspeedKt).toBe(0)
    expect(initial.commandedAltitudeFt).toBe(initial.targetAltitudeFt)
    expect(initial.angleOfAttackDeg).toBe(0)
    expect(initial.flightPathAngleDeg).toBe(0)
    expect(groundRoll.flightPhase).toBe('GROUND ROLL')
    expect(groundRoll.altitudeFt).toBe(route.points[0].altitude_ft)
    expect(groundRoll.angleOfAttackDeg).toBe(0)
    expect(groundRoll.flightPathAngleDeg).toBe(0)
    expect(rotation.flightPhase).toBe('ROTATION')
    expect(rotation.pitchDeg).toBeGreaterThan(2)
    expect(rotation.angleOfAttackDeg).toBeGreaterThan(2)
    expect(rotation.flightPathAngleDeg).toBeGreaterThan(0)
    expect(rotation.verticalSpeedFpm).toBeGreaterThan(500)
    expect(climb.flightPhase).toBe('CLIMB')
    expect(climb.altitudeFt).toBeGreaterThan(rotation.altitudeFt)
    expect(climb.angleOfAttackDeg).toBeGreaterThan(1)
    expect(climb.flightPathAngleDeg).toBeGreaterThan(0)
    expect(climb.safetyViolations).not.toContain('ALTITUDE')
    expect(cruise.flightPhase).toBe('CRUISE')
    expect(cruise.pitchDeg).toBeGreaterThan(1)
    expect(cruise.pitchDeg).toBeLessThan(4)
    expect(cruise.angleOfAttackDeg).toBeGreaterThan(1)
    expect(cruise.angleOfAttackDeg).toBeLessThan(4)
    expect(Math.abs(cruise.flightPathAngleDeg)).toBeLessThan(1)
    expect(Math.abs(cruise.verticalSpeedFpm)).toBeLessThan(300)
    expect(descent.flightPhase).toBe('DESCENT')
    expect(descent.pitchDeg).toBeLessThan(0)
    expect(descent.angleOfAttackDeg).toBeGreaterThan(0)
    expect(descent.flightPathAngleDeg).toBeLessThan(0)
    expect(descent.pitchDeg).toBeGreaterThan(descent.flightPathAngleDeg)
    expect(descent.verticalSpeedFpm).toBeLessThan(-500)
    expect(landed.flightPhase).toBe('LANDED')
    expect(landed.altitudeFt).toBe(route.points.at(-1)!.altitude_ft)
    expect(landed.airspeedKt).toBe(0)
    expect(landed.angleOfAttackDeg).toBe(0)
    expect(landed.flightPathAngleDeg).toBe(0)
    expect(landed.alongTrackM).toBeLessThanOrEqual(routeLength(route))
  })

  it('uses the runway-aligned route geometry for a continuous departure and curved climb', () => {
    const route = fallbackConfig.routes[0]
    const departure = trace('secure', [], 180)
    const takeoffRollEnd = departure[route.performance.takeoff_roll_seconds - 1]
    const rotation = departure[30]
    const initialClimb = departure[60]
    const firstLegLengthM = haversineMeters(route.points[0], route.points[1])
    const runwayBearingDeg = initialBearing(route.points[0], route.points[1])
    const departureTurnBearingDeg = initialBearing(route.points[2], route.points[3])

    expect(takeoffRollEnd.flightPhase).toBe('GROUND ROLL')
    expect(takeoffRollEnd.altitudeFt).toBe(route.points[0].altitude_ft)
    expect(takeoffRollEnd.alongTrackM).toBeGreaterThan(500)
    expect(takeoffRollEnd.alongTrackM).toBeLessThan(firstLegLengthM)
    expect(routePointAtDistance(route, rotation.alongTrackM).segmentIndex).toBe(0)
    expect(Math.abs(rotation.rollDeg)).toBeLessThan(1)
    expect(rotation.altitudeFt).toBeGreaterThan(route.points[0].altitude_ft)
    expect(initialClimb.altitudeFt).toBeGreaterThan(rotation.altitudeFt)
    expect(Math.abs(runwayBearingDeg - departureTurnBearingDeg)).toBeGreaterThan(20)
    expect(departure.some((state) => routePointAtDistance(route, state.alongTrackM).segmentIndex >= 2)).toBe(true)

    for (let index = 1; index < departure.length; index += 1) {
      const previous = departure[index - 1]
      const current = departure[index]
      expect(current.alongTrackM).toBeGreaterThanOrEqual(previous.alongTrackM)
      expect(current.alongTrackM - previous.alongTrackM).toBeLessThanOrEqual(180)
      expect(Math.abs(current.altitudeFt - previous.altitudeFt)).toBeLessThanOrEqual(route.performance.max_climb_fpm / 60 + 1e-6)
      expect(haversineMeters(previous.truePosition, current.truePosition)).toBeLessThan(220)
    }
  })

  it('keeps every profile and attack inside the finite physical aircraft envelope', () => {
    const attackCases = [
      { label: 'nominal', attacks: [] as AttackScenario[] },
      ...fallbackConfig.attacks.map((attack) => ({ label: attack.id, attacks: [attack] })),
      { label: 'all-scenarios', attacks: fallbackConfig.attacks },
    ]

    for (const route of fallbackConfig.routes) {
      for (const profile of ['secure', 'vulnerable'] as const) {
        for (const attackCase of attackCases) {
          const context: SimulationContext = {
            route,
            attacks: attackCase.attacks,
            safety: fallbackConfig.safety_defaults,
          }
          let state = initialAircraftState(profile, context)
          let maximumAltitudeFt = state.altitudeFt
          let previousAlongTrackM = state.alongTrackM

          for (let second = 0; second < 1500; second += 1) {
            state = advanceAircraft(state, profile, context, 1)
            const label = `${route.id}/${profile}/${attackCase.label}/t=${second + 1}`
            const numericValues = [
              state.time,
              state.truePosition.lat,
              state.truePosition.lon,
              state.estimatedPosition.lat,
              state.estimatedPosition.lon,
              state.commandedPosition.lat,
              state.commandedPosition.lon,
              state.altitudeFt,
              state.estimatedAltitudeFt,
              state.targetAltitudeFt,
              state.commandedAltitudeFt,
              state.rollDeg,
              state.pitchDeg,
              state.angleOfAttackDeg,
              state.flightPathAngleDeg,
              state.headingDeg,
              state.yawRateDegS,
              state.crossTrackM,
              state.estimatedCrossTrackM,
              state.targetCrossTrackM,
              state.alongTrackM,
              state.airspeedKt,
              state.indicatedAirspeedKt,
              state.groundSpeedKt,
              state.verticalSpeedFpm,
            ]
            if (!numericValues.every(Number.isFinite)) throw new Error(`${label}: non-finite aircraft state`)
            if (state.altitudeFt < 0 || state.altitudeFt > DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt) throw new Error(`${label}: altitude ${state.altitudeFt}`)
            if (state.estimatedAltitudeFt < 0 || state.estimatedAltitudeFt > DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt) throw new Error(`${label}: estimated altitude ${state.estimatedAltitudeFt}`)
            if (state.commandedAltitudeFt < 0 || state.commandedAltitudeFt > DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt) throw new Error(`${label}: commanded altitude ${state.commandedAltitudeFt}`)
            if (Math.abs(state.rollDeg) > DEMO_AIRCRAFT_ENVELOPE.maxRollDeg + 1e-9) throw new Error(`${label}: roll ${state.rollDeg}`)
            if (Math.abs(state.pitchDeg) > DEMO_AIRCRAFT_ENVELOPE.maxPitchDeg + 1e-9) throw new Error(`${label}: pitch ${state.pitchDeg}`)
            if (state.angleOfAttackDeg < 0 || state.angleOfAttackDeg > DEMO_AIRCRAFT_ENVELOPE.maxAngleOfAttackDeg) throw new Error(`${label}: angle of attack ${state.angleOfAttackDeg}`)
            if (Math.abs(state.flightPathAngleDeg) > DEMO_AIRCRAFT_ENVELOPE.maxFlightPathAngleDeg) throw new Error(`${label}: flight-path angle ${state.flightPathAngleDeg}`)
            if (Math.abs(state.yawRateDegS) > DEMO_AIRCRAFT_ENVELOPE.maxYawRateDegS) throw new Error(`${label}: yaw rate ${state.yawRateDegS}`)
            if (state.airspeedKt < 0 || state.airspeedKt > DEMO_AIRCRAFT_ENVELOPE.maxTrueAirspeedKt) throw new Error(`${label}: airspeed ${state.airspeedKt}`)
            if (state.indicatedAirspeedKt < 0 || state.indicatedAirspeedKt > DEMO_AIRCRAFT_ENVELOPE.maxIndicatedAirspeedKt) throw new Error(`${label}: indicated airspeed ${state.indicatedAirspeedKt}`)
            if (state.groundSpeedKt < 0 || state.groundSpeedKt > DEMO_AIRCRAFT_ENVELOPE.maxGroundSpeedKt) throw new Error(`${label}: ground speed ${state.groundSpeedKt}`)
            if (state.verticalSpeedFpm < -route.performance.max_descent_fpm - 1e-9 || state.verticalSpeedFpm > route.performance.max_climb_fpm + 1e-9) throw new Error(`${label}: vertical speed ${state.verticalSpeedFpm}`)
            if (state.headingDeg < 0 || state.headingDeg >= 360) throw new Error(`${label}: heading ${state.headingDeg}`)
            if (state.alongTrackM < previousAlongTrackM - 1e-9 || state.alongTrackM > routeLength(route) + 1e-6) throw new Error(`${label}: along-track ${state.alongTrackM}`)
            if (Math.abs(state.crossTrackM) > 300_000) throw new Error(`${label}: cross-track ${state.crossTrackM}`)
            if (state.truePosition.lat < -90 || state.truePosition.lat > 90 || state.truePosition.lon < -180 || state.truePosition.lon > 180) throw new Error(`${label}: invalid WGS84 position`)

            maximumAltitudeFt = Math.max(maximumAltitudeFt, state.altitudeFt)
            previousAlongTrackM = state.alongTrackM
          }
          expect(maximumAltitudeFt, `${route.id}/${profile}/${attackCase.label}`).toBeLessThanOrEqual(DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt)
        }
      }
    }
  })

  it('contains a persistent erroneous altitude target at the independent aircraft ceiling', () => {
    const base = scenario('mcdu_altitude_tamper')
    const persistentHighTarget: AttackScenario = {
      ...base,
      activation_seconds: 0,
      magnitude: { mcdu_altitude_offset_ft: 15_000 },
      effect: {
        ...base.effect,
        phase_gate: ['ROTATION', 'CLIMB', 'CRUISE', 'DESCENT', 'APPROACH'],
        rise_seconds: 0,
        duration_seconds: null,
        fall_seconds: 0,
        waveform: 'step',
      },
    }
    const context: SimulationContext = {
      route: fallbackConfig.routes[0],
      attacks: [persistentHighTarget],
      safety: fallbackConfig.safety_defaults,
    }
    let state = initialAircraftState('vulnerable', context)
    let maximumAltitudeFt = state.altitudeFt
    for (let second = 0; second < 2000; second += 1) {
      state = advanceAircraft(state, 'vulnerable', context, 1)
      maximumAltitudeFt = Math.max(maximumAltitudeFt, state.altitudeFt)
    }

    expect(maximumAltitudeFt).toBe(DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt)
    expect(state.altitudeFt).toBeLessThanOrEqual(DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt)
    expect(state.commandedAltitudeFt).toBeLessThanOrEqual(DEMO_AIRCRAFT_ENVELOPE.maxAltitudeFt)
  })

  it('keeps pitch, air-relative angle of attack, and trajectory angle distinct', () => {
    expect(flightPathAngleFromVelocity(0, 250)).toBe(0)
    expect(flightPathAngleFromVelocity(1000, 120)).toBeCloseTo(4.704, 3)
    expect(flightPathAngleFromVelocity(-1000, 120)).toBeCloseTo(-4.704, 3)
    expect(flightPathAngleFromVelocity(1000, 0)).toBe(0)

    const context: SimulationContext = {
      route: fallbackConfig.routes[0],
      attacks: [],
      safety: fallbackConfig.safety_defaults,
    }
    let state = initialAircraftState('secure', context)
    for (let second = 0; second < 1500; second += 1) {
      state = advanceAircraft(state, 'secure', context, 1)
      expect(Number.isFinite(state.angleOfAttackDeg)).toBe(true)
      expect(Number.isFinite(state.flightPathAngleDeg)).toBe(true)
      expect(state.angleOfAttackDeg).toBeGreaterThanOrEqual(0)
      expect(state.angleOfAttackDeg).toBeLessThanOrEqual(8.1)
      if (state.flightPhase !== 'GROUND ROLL' && state.flightPhase !== 'LANDED') {
        expect(state.pitchDeg).toBeCloseTo(state.flightPathAngleDeg + state.angleOfAttackDeg, 8)
      }
    }
  })

  it('keeps a nominal full flight inside the configured safety envelope', () => {
    const context: SimulationContext = {
      route: fallbackConfig.routes[0],
      attacks: [],
      safety: fallbackConfig.safety_defaults,
    }
    let state = initialAircraftState('secure', context)
    for (let second = 0; second < 1500; second += 1) {
      state = advanceAircraft(state, 'secure', context, 1)
      expect(state.safetyViolations).toEqual([])
    }
  })

  it('gates radio-height loss to low approach without fabricating pitch or altitude', () => {
    const route = fallbackConfig.routes[0]
    const attackedContext: SimulationContext = {
      route,
      attacks: [scenario('radio_altimeter_fault')],
      safety: fallbackConfig.safety_defaults,
    }
    const nominalContext: SimulationContext = { ...attackedContext, attacks: [] }
    let attacked = initialAircraftState('vulnerable', attackedContext)
    let nominal = initialAircraftState('vulnerable', nominalContext)
    let observed = false

    for (let second = 0; second < 1500; second += 1) {
      attacked = advanceAircraft(attacked, 'vulnerable', attackedContext, 1)
      nominal = advanceAircraft(nominal, 'vulnerable', nominalContext, 1)
      if (attacked.navMode !== 'APPROACH STATE STALE') continue
      observed = true
      expect(attacked.flightPhase).toBe('APPROACH')
      expect(attacked.altitudeFt - route.points.at(-1)!.altitude_ft).toBeLessThanOrEqual(2500)
      expect(attacked.pitchDeg).toBeCloseTo(nominal.pitchDeg, 10)
      expect(attacked.commandedPitchDeg).toBeCloseTo(nominal.commandedPitchDeg, 10)
      expect(attacked.altitudeFt).toBeCloseTo(nominal.altitudeFt, 10)
      expect(attacked.estimatedAltitudeFt).toBeCloseTo(attacked.altitudeFt, 10)
      break
    }
    expect(observed).toBe(true)
  })

  it('keeps accelerated playback physically identical to one-second integration', () => {
    const context: SimulationContext = {
      route: fallbackConfig.routes[0],
      attacks: [fallbackConfig.attacks[0]],
      safety: fallbackConfig.safety_defaults,
    }
    const initial = initialAircraftState('vulnerable', context)
    let stepped = initial
    for (let index = 0; index < 64; index += 1) stepped = advanceAircraft(stepped, 'vulnerable', context, 1)
    expect(advanceAircraftForDuration(initial, 'vulnerable', context, 64)).toEqual(stepped)
  })

  it('projects ground speed onto the route tangent after a diversion', () => {
    const context: SimulationContext = {
      route: fallbackConfig.routes[0],
      attacks: [],
      safety: fallbackConfig.safety_defaults,
    }
    const airborne = run('secure', [], 80)
    const nominal = advanceAircraft(airborne, 'secure', context, 1)
    const diverted = advanceAircraft({ ...airborne, headingDeg: (airborne.headingDeg + 60) % 360 }, 'secure', context, 1)
    const nominalProgress = nominal.alongTrackM - airborne.alongTrackM
    const divertedProgress = diverted.alongTrackM - airborne.alongTrackM
    expect(divertedProgress).toBeGreaterThan(0)
    expect(divertedProgress).toBeLessThan(nominalProgress * 0.3)
  })
})
