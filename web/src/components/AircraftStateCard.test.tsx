import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AircraftState } from '../types'
import { AircraftStateCard } from './AircraftStateCard'

afterEach(cleanup)

const state: AircraftState = {
  time: 91,
  truePosition: { lat: 52.1, lon: 13.2 },
  estimatedPosition: { lat: 52.1, lon: 13.2 },
  commandedPosition: { lat: 52.1, lon: 13.2 },
  altitudeFt: 10134,
  estimatedAltitudeFt: 10134,
  targetAltitudeFt: 11000,
  commandedAltitudeFt: 11000,
  rollDeg: -3.2,
  pitchDeg: 4.5,
  angleOfAttackDeg: 6.1,
  flightPathAngleDeg: 3.4,
  headingDeg: 214,
  yawRateDegS: -0.3,
  commandedRollDeg: 0,
  commandedPitchDeg: 0,
  crossTrackM: -1852,
  estimatedCrossTrackM: -1852,
  targetCrossTrackM: 0,
  alongTrackM: 1000,
  airspeedKt: 240,
  indicatedAirspeedKt: 238,
  groundSpeedKt: 245,
  verticalSpeedFpm: 800,
  flightPhase: 'CLIMB',
  navMode: 'FMS',
  source: 'IRS',
  busHealth: 'degraded',
  safetyViolations: [],
}

describe('AircraftStateCard', () => {
  it('labels simulator telemetry as physical plant state and exposes the requested attitude fields', () => {
    render(<AircraftStateCard profile="secure" state={state} />)

    expect(screen.getByLabelText('secure live aircraft physical state')).toBeInTheDocument()
    expect(screen.getByLabelText('Aircraft heading 214 degrees')).toBeInTheDocument()
    expect(screen.getByText('Angle of attack')).toBeInTheDocument()
    expect(screen.getByText('+6.1°')).toBeInTheDocument()
    expect(screen.getByText('−1.00 NM')).toBeInTheDocument()
    expect(screen.getByLabelText('Aircraft external and physical interfaces')).toHaveTextContent('GNSS / RF')
    expect(screen.getByLabelText('Aircraft external and physical interfaces')).toHaveTextContent('AFDX / control ingress')
  })
})
