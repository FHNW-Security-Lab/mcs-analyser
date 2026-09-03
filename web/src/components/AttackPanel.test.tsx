import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttackScenario } from '../types'
import { AttackPanel } from './AttackPanel'
import { PropagationGraph } from './PropagationGraph'

afterEach(cleanup)

const approachScenario: AttackScenario = {
  id: 'radio_altimeter_fault',
  title: 'Radio-height loss on approach',
  category: 'fault',
  summary: 'Both radio-height channels become unavailable below the configured approach gate.',
  source: 'D2.5 radio-altimeter chain',
  activation_seconds: 10,
  magnitude: { radio_altimeter_loss: 1 },
  signal_property: 'availability',
  attack_surface: 'Radio-altimeter antennas and ARINC-429 receive path',
  preconditions: ['Approach phase active', 'Aircraft below 2,500 ft AGL'],
  operating_window: 'Approach below 2,500 ft AGL',
  detection: ['Dual-channel invalid status', 'Radio-height monitor timeout'],
  hazard: 'Loss of automatic radio-height functions during approach.',
  effect: {
    trigger: 'elapsed_time_and_phase',
    phase_gate: ['APPROACH'],
    max_agl_ft: 2500,
    rise_seconds: 1,
    duration_seconds: null,
    fall_seconds: 0,
    waveform: 'step',
    analysis_activation_seconds: 10,
  },
  evidence: {
    coverage: 'partial',
    native_components: ['radio_altimeter_1', 'radio_height_monitor'],
    message_types: ['MSG_AFDX_VL_RADIO_HEIGHT_1'],
    note: 'The receiver/monitor chain is native; the antenna loss is configured.',
  },
  secure_response: 'The monitor announces the loss and reverts the protected aircraft.',
  vulnerable_response: 'The stale height remains authoritative.',
  steps: [
    {
      id: 'loss', label: 'Dual sensor loss', component: 'radio_altimeter_1', at_seconds: 10, kind: 'fault', depends_on: [],
      note: 'The external fault invalidates both independent words.', secure_status: 'attempted', vulnerable_status: 'attempted',
    },
    {
      id: 'monitor', label: 'Monitor decision', component: 'radio_height_monitor', at_seconds: 12, kind: 'decision', depends_on: ['loss'],
      note: 'The monitor compares validity and freshness.', secure_status: 'blocked', vulnerable_status: 'unsafe',
    },
  ],
  tags: ['approach', 'availability'],
}

describe('scenario realism presentation', () => {
  it('distinguishes an armed scenario from an effect whose operating gate is satisfied', () => {
    const props = {
      scenarios: [approachScenario],
      selectedIds: [approachScenario.id],
      focusedId: approachScenario.id,
      onToggle: vi.fn(),
      onFocus: vi.fn(),
      time: 20,
      heightAglFt: 1800,
    }
    const { rerender } = render(<AttackPanel {...props} flightPhase="CRUISE" />)

    expect(screen.getByLabelText('Armed; effect not currently applied')).toBeInTheDocument()
    expect(screen.queryByLabelText('Effect currently applied')).not.toBeInTheDocument()
    expect(screen.getByText('Armed, gate not yet satisfied')).toBeInTheDocument()
    expect(screen.getAllByText('Partial MCA').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Radio-height loss on approach step timeline')).toHaveTextContent('Monitor decision')

    rerender(<AttackPanel {...props} flightPhase="APPROACH" />)
    expect(screen.getByLabelText('Effect currently applied')).toBeInTheDocument()
    expect(screen.getByText('Effect applied now')).toBeInTheDocument()
  })

  it('shows profile-specific stage outcomes and the armed gate state', () => {
    const props = {
      scenario: approachScenario,
      enabled: true,
      time: 20,
      heightAglFt: 1800,
      onProfileChange: vi.fn(),
    }
    const { rerender } = render(<PropagationGraph {...props} profile="secure" flightPhase="CRUISE" />)

    expect(screen.getAllByText('Armed / gated').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('secure component propagation path')).toHaveTextContent('Monitor decision')

    rerender(<PropagationGraph {...props} profile="vulnerable" flightPhase="APPROACH" />)
    expect(screen.getAllByText('Unsafe effect').length).toBeGreaterThan(0)
  })
})
