import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fallbackConfig } from '../data/fallback'
import { initialAircraftState } from '../sim/engine'
import { AttitudeIndicator } from './AttitudeIndicator'

describe('ALB attitude telemetry', () => {
  it('separates angle of attack from the flight-path climb angle', () => {
    const context = {
      route: fallbackConfig.routes[0],
      attacks: [],
      safety: fallbackConfig.safety_defaults,
    }
    const state = {
      ...initialAircraftState('secure', context),
      airspeedKt: 190,
      pitchDeg: 7.3,
      angleOfAttackDeg: 4.2,
      flightPathAngleDeg: 3.1,
      flightPhase: 'CLIMB' as const,
    }

    render(<AttitudeIndicator profile="secure" state={state} />)

    expect(screen.getByText('ANGLE OF ATTACK')).toBeInTheDocument()
    expect(screen.getByText('AOA α · ANSTELLWINKEL')).toBeInTheDocument()
    expect(screen.getByText('FLIGHT-PATH ANGLE')).toBeInTheDocument()
    expect(screen.getByText('FPA γ · STEIGUNGSWINKEL')).toBeInTheDocument()
    expect(screen.getByText('+4.2°')).toBeInTheDocument()
    expect(screen.getByText('+3.1°')).toBeInTheDocument()
    expect(screen.getByLabelText('Pitch equals flight-path angle plus angle of attack in still air')).toBeInTheDocument()
    expect(screen.getByLabelText('Roll 0.0 degrees, pitch 7.3 degrees, angle of attack 4.2 degrees, flight-path angle 3.1 degrees')).toBeInTheDocument()
  })
})
