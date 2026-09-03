import { describe, expect, it } from 'vitest'
import type { McaArtifact } from '../types'
import {
  concreteMessageById,
  constraintRecordsForComponent,
  constraintRecordsForTrace,
  constraintRecordsForTransition,
  decodeAttitudeHex,
  explainConstraint,
  formatCapturedConstraint,
  preferredConstraintIndex,
} from './mcaConstraints'

const rawPredicates = [
  { format: 'claripy-str', text: '<Bool input[63:32] >=s 0xfaa2b580>', variables: ['input'] },
  { format: 'claripy-str', text: '<Bool input[63:32] <=s 0x55d4a80>', variables: ['input'] },
  { format: 'claripy-str', text: '<Bool input[31:0] >=s 0xf5456b00>', variables: ['input'] },
  { format: 'claripy-str', text: '<Bool input[31:0] <=s 0xaba9500>', variables: ['input'] },
]

const artifact = {
  components: [
    { id: 'gnss', name: 'GNSS Receiver' },
    { id: 'fusion', name: 'Vulnerable Navigation Fusion' },
    { id: 'effect', name: 'Aircraft Dynamics Effect' },
  ],
  communication_edges: [
    { source_component_id: 'gnss', target_component_id: 'fusion', message_id: 1, message_type_name: 'MSG_AFDX_VL_GNSS_POSITION', reachability: 'reachable_from_configured_sources', constraints: rawPredicates },
    { source_component_id: 'fusion', target_component_id: 'effect', message_id: 67, message_type_name: 'MSG_AFDX_VL_NAV_SOLUTION', reachability: 'reachable_from_configured_sources', constraints: rawPredicates },
    { source_component_id: 'fusion', target_component_id: 'effect', message_id: 12, message_type_name: 'MSG_AFDX_VL_NAV_SOLUTION', reachability: 'discovery_only', constraints: [] },
  ],
  constraints: [
    { message_id: 1, producer_component_id: 'gnss', message_type_id: 1, message_type_name: 'MSG_AFDX_VL_GNSS_POSITION', reachability: 'reachable_from_configured_sources', payload_expression: '<BV64 input>', variables: ['input'], predicates: rawPredicates },
    { message_id: 67, producer_component_id: 'fusion', message_type_id: 2, message_type_name: 'MSG_AFDX_VL_NAV_SOLUTION', reachability: 'reachable_from_configured_sources', payload_expression: '<BV64 input>', variables: ['input'], predicates: rawPredicates },
    { message_id: 12, producer_component_id: 'fusion', message_type_id: 2, message_type_name: 'MSG_AFDX_VL_NAV_SOLUTION', reachability: 'discovery_only', payload_expression: '<BV64 fusion_input>', variables: ['fusion_input'], predicates: [] },
  ],
  messages: [
    { id: 1, producer_component_id: 'gnss', reachability: 'reachable_from_configured_sources', type: { id: 1, name: 'MSG_AFDX_VL_GNSS_POSITION' }, data: { kind: 'symbolic', expression: '<BV64 input>', constraints: rawPredicates } },
    { id: 67, producer_component_id: 'fusion', reachability: 'reachable_from_configured_sources', type: { id: 2, name: 'MSG_AFDX_VL_NAV_SOLUTION' }, data: { kind: 'symbolic', expression: '<BV64 input>', constraints: rawPredicates } },
    { id: 265, producer_component_id: 'effect', reachability: 'reachable_from_configured_sources', type: { id: 3, name: 'MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE' }, data: { kind: 'concrete', hex: '0x00001b5846500001', constraints: [] } },
  ],
} as unknown as McaArtifact

describe('MCA constraint evidence', () => {
  it('joins only the selected transition message alternatives', () => {
    const records = constraintRecordsForTransition(artifact, {
      id: 'mca:fusion->effect',
      sourceId: 'fusion',
      targetId: 'effect',
      channelNames: [],
      messageIds: [12, 67],
      reachableMessageIds: [67],
      discoveryMessageIds: [12],
      constraintCount: 4,
      instanceCount: 2,
      reachability: 'reachable',
    })
    expect(records.map((record) => record.message_id)).toEqual([12, 67])
    expect(preferredConstraintIndex(records, 67)).toBe(1)
  })

  it('keeps message records as alternatives and predicates inside a record as a conjunction', () => {
    const records = constraintRecordsForTrace(artifact, [
      [1, 'GNSS Receiver', []],
      [67, 'Vulnerable Navigation Fusion', [1]],
      [265, 'Aircraft Dynamics Effect', [67]],
    ])
    expect(records).toHaveLength(2)
    expect(records[1].predicates).toEqual(rawPredicates)
    expect(explainConstraint(records[1], 'vulnerable').conditions).toContain('All 4 captured payload predicates are inherited from the GNSS fix.')
  })

  it('shows only messages produced by a selected component', () => {
    expect(constraintRecordsForComponent(artifact, 'fusion').map((record) => record.message_id)).toEqual([67, 12])
  })

  it('provides an exact readable GNSS contract without changing the raw record', () => {
    const record = artifact.constraints[0]
    const explanation = explainConstraint(record, 'vulnerable')
    expect(explanation.conditions).toEqual([
      'Latitude [63:32], signed microdegrees: −90° to +90°.',
      'Longitude [31:0], signed microdegrees: −180° to +180°.',
    ])
    const full = formatCapturedConstraint(record)
    expect(full).toContain(rawPredicates[0].text)
    expect(full).toContain(rawPredicates[3].text)
  })

  it('decodes a concrete unsafe witness with BigInt-safe fixed-point fields', () => {
    expect(decodeAttitudeHex('0x00001b5846500001')).toEqual({
      pitchDeg: 0,
      rollDeg: 70,
      headingDeg: 180,
      flags: ['NAV_DIRECT'],
    })
    expect(decodeAttitudeHex('0x0000e4a846500001')?.rollDeg).toBe(-70)
    expect(concreteMessageById(artifact, 265)?.data?.hex).toBe('0x00001b5846500001')
  })

  it('does not mistake a symbolic zero-predicate record for a concrete message', () => {
    const zeroPredicate = artifact.constraints.find((record) => record.message_id === 12)!
    expect(explainConstraint(zeroPredicate, 'vulnerable').conditions).toContain('No additional payload-relevant predicate was captured for this symbolic record.')
    expect(concreteMessageById(artifact, 12)).toBeNull()
  })
})
