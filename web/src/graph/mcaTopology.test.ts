import { describe, expect, it } from 'vitest'
import type { McaArtifact } from '../types'
import { aggregateMcaTransitions, chooseBestTraceMessage, firstUnsafeWitness, getMcaTrace } from './mcaTopology'

const artifact = {
  components: [
    { id: 'sensor', name: 'Sensor' },
    { id: 'voter', name: 'Voter' },
    { id: 'effect', name: 'Effect' },
  ],
  communication_edges: [
    { source_component_id: 'sensor', target_component_id: 'voter', message_id: 1, message_type_name: 'RAW', reachability: 'discovery_only', constraints: [] },
    { source_component_id: 'sensor', target_component_id: 'voter', message_id: 2, message_type_name: 'RAW', reachability: 'reachable_from_configured_sources', constraints: [{ text: 'x > 0' }] },
    { source_component_id: 'voter', target_component_id: 'effect', message_id: 3, message_type_name: 'VOTED', reachability: 'reachable_from_configured_sources', constraints: [] },
  ],
  messages: [
    { id: 1, producer_component_id: 'sensor', reachability: 'discovery_only' },
    { id: 2, producer_component_id: 'sensor', reachability: 'reachable_from_configured_sources' },
    { id: 3, producer_component_id: 'effect', reachability: 'reachable_from_configured_sources' },
  ],
  traces: {
    '1': [[[1, 'Sensor', []]]],
    '2': [[[2, 'Sensor', []]]],
    '3': [[[2, 'Sensor', []], [4, 'Voter', [2]], [3, 'Effect', [4]]]],
  },
  safety_findings: [{ id: 'unsafe', property: 'safe', status: 'violated', reachable_violation_message_ids: [3] }],
} as unknown as McaArtifact

describe('MCA topology projection', () => {
  it('aggregates raw message instances while preserving reachability evidence', () => {
    const transitions = aggregateMcaTransitions(artifact.communication_edges)
    expect(transitions).toHaveLength(2)
    expect(transitions[0]).toMatchObject({ instanceCount: 2, reachability: 'reachable', messageIds: [1, 2] })
  })

  it('reconstructs component transitions from message input IDs', () => {
    expect(getMcaTrace(artifact, 3)).toMatchObject({
      nodeIds: ['sensor', 'voter', 'effect'],
      pairKeys: ['sensor->voter', 'voter->effect'],
    })
  })

  it('prefers a configured-source trace and exposes the unsafe witness', () => {
    expect(chooseBestTraceMessage(artifact, [1, 2])).toBe(2)
    expect(firstUnsafeWitness(artifact)).toBe(3)
  })
})
