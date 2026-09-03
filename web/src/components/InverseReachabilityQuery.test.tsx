import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fallbackConfig } from '../data/fallback'
import type { AircraftState, InverseReachabilityResult, McaArtifact } from '../types'
import { InverseReachabilityQuery } from './InverseReachabilityQuery'

afterEach(cleanup)

const state = (rollDeg: number): AircraftState => ({
  time: 90,
  truePosition: { lat: 52.1, lon: 13.2 }, estimatedPosition: { lat: 52.1, lon: 13.2 }, commandedPosition: { lat: 52.1, lon: 13.2 },
  altitudeFt: 10000, estimatedAltitudeFt: 10000, targetAltitudeFt: 11000, commandedAltitudeFt: 11000,
  rollDeg, pitchDeg: 2, angleOfAttackDeg: 5, flightPathAngleDeg: 3, headingDeg: 210, yawRateDegS: 0.2,
  commandedRollDeg: 0, commandedPitchDeg: 0, crossTrackM: 1852, estimatedCrossTrackM: 1852, targetCrossTrackM: 0, alongTrackM: 1000,
  airspeedKt: 240, indicatedAirspeedKt: 238, groundSpeedKt: 245, verticalSpeedFpm: 800,
  flightPhase: 'CLIMB', navMode: 'FMS', source: 'IRS', busHealth: 'degraded', safetyViolations: [],
})

const vulnerableArtifact = {
  components: [
    { id: 'control_domain_ingress', name: 'Adversarial Control-Domain Ingress', role: 'source' },
    { id: 'flight_guidance', name: 'Flight Guidance Computer', role: 'processor' },
    { id: 'aircraft_effect', name: 'Aircraft Dynamics Effect', role: 'effect' },
  ],
  messages: [{ id: 10, producer_component_id: 'aircraft_effect', reachability: 'reachable_from_configured_sources', type: { name: 'MSG_AFDX_VL_ACTUATOR_COMMAND' } }],
  traces: { '10': [[[1, 'Adversarial Control-Domain Ingress', []], [2, 'Flight Guidance Computer', [1]], [10, 'Aircraft Dynamics Effect', [2]]]] },
  constraints: [{
    message_id: 10,
    producer_component_id: 'aircraft_effect',
    message_type_id: 7,
    message_type_name: 'MSG_AFDX_VL_ACTUATOR_COMMAND',
    reachability: 'reachable_from_configured_sources',
    payload_expression: 'roll_command_0_32',
    predicates: [{ text: 'roll_command_0_32 <= 55' }],
  }],
} as unknown as McaArtifact

const secureArtifact = {
  components: [{ id: 'envelope_protection', name: 'Secure Envelope Protection', role: 'safeguard' }],
  messages: [], traces: {}, constraints: [],
} as unknown as McaArtifact

const result: InverseReachabilityResult = {
  schema_version: '1.0',
  status: 'complete',
  engine: 'exact Z3 backward target query over MCA contracts and bounded plant dynamics',
  semantics: 'SAT means one admissible bounded input sequence reaches every selected target field at the same proof step.',
  evidence_boundary: 'angr/MCA establishes native component-message feasibility; the plant is an explicit demonstrator assumption.',
  target: { roll_deg: 36 },
  target_tolerances: { roll_deg: { value: 0.75, unit: 'deg' } },
  attack_ids: ['control_command_injection'],
  relevant_attack_ids: ['control_command_injection'],
  horizon_seconds: 90,
  step_seconds: 6,
  profiles: {
    secure: {
      status: 'unsat', reachable: false, witness_seconds: null, reached_state: null, witness_inputs: [],
      solver: 'Z3 UNSAT within the declared bounds', constraint_count: 404,
      individually_enabling_scenarios: [], combination_required: false,
      blocking_evidence: [{
        scenario_id: 'control_command_injection', scenario_title: 'Control-domain command injection', component_id: 'envelope_protection',
        decision: 'Envelope rejects command', evidence: 'native', message_types: ['MSG_AFDX_VL_ACTUATOR_COMMAND'],
      }],
    },
    vulnerable: {
      status: 'sat', reachable: true, witness_seconds: 36,
      reached_state: { roll_deg: 39.8, pitch_deg: 1, yaw_rate_deg_s: 0.4, heading_error_deg: 4, course_deviation_nm: 0.3, altitude_deviation_ft: 10 },
      witness_inputs: [{ input: 'direct_roll_command_deg', magnitude_key: 'roll_injection_deg', value: 45, unit: 'deg', seconds: 24, scenario_ids: ['control_command_injection'] }],
      solver: 'Z3 SAT target-state witness', constraint_count: 398,
      individually_enabling_scenarios: [{
        id: 'control_command_injection', title: 'Control-domain command injection', evidence: 'native',
        native_components: ['control_domain_ingress', 'flight_guidance'], message_types: ['MSG_AFDX_VL_ACTUATOR_COMMAND'], witness_seconds: 36,
      }],
      combination_required: false, blocking_evidence: [],
    },
  },
}

describe('inverse aircraft-state query', () => {
  it('submits the selected target and visualizes SAT, UNSAT, inputs, chains, and safeguards', async () => {
    const runQuery = vi.fn().mockResolvedValue(result)
    render(
      <InverseReachabilityQuery
        artifacts={{ secure: secureArtifact, vulnerable: vulnerableArtifact }}
        scenario={fallbackConfig.attacks[0]}
        secureState={state(1)}
        vulnerableState={state(8)}
        runQuery={runQuery}
      />,
    )

    expect(screen.getByLabelText('Backward constraint/query analysis')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run backward query' }))

    expect(await screen.findByText('Target reachable')).toBeInTheDocument()
    expect(runQuery).toHaveBeenCalledWith({ roll_deg: 36 }, undefined, 90, 6)
    expect(screen.getByText(/direct roll command deg/i)).toBeInTheDocument()
    expect(screen.getByText(/Secure Envelope Protection/)).toBeInTheDocument()
    expect(screen.getByText('Adversarial Control-Domain Ingress')).toBeInTheDocument()
    expect(screen.getByText('Flight Guidance Computer')).toBeInTheDocument()
  })

  it('lets the operator drag the target aircraft state before solving', async () => {
    const runQuery = vi.fn().mockResolvedValue(result)
    render(
      <InverseReachabilityQuery
        artifacts={{ secure: secureArtifact, vulnerable: vulnerableArtifact }}
        scenario={fallbackConfig.attacks.find((item) => item.id === 'afdx_injection') ?? fallbackConfig.attacks[0]}
        secureState={state(1)}
        vulnerableState={state(8)}
        runQuery={runQuery}
      />,
    )

    fireEvent.change(screen.getByLabelText('Move target Roll angle'), { target: { value: '37.5' } })
    fireEvent.change(screen.getByLabelText('Inverse query scenario scope'), { target: { value: 'focused' } })
    expect(screen.getByText('+37.5 deg')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run backward query' }))
    expect(await screen.findByText('Target reachable')).toBeInTheDocument()
    expect(runQuery).toHaveBeenCalledWith({ roll_deg: 37.5 }, ['afdx_injection'], 90, 6)
  })
})
