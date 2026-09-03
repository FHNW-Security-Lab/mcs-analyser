import type { McaArtifact, McaEdge, McaTraceEntry } from '../types'

export interface McaTransition {
  id: string
  sourceId: string
  targetId: string
  channelNames: string[]
  messageIds: number[]
  reachableMessageIds: number[]
  discoveryMessageIds: number[]
  constraintCount: number
  instanceCount: number
  reachability: 'reachable' | 'discovery_only' | 'unknown'
}

export interface McaTracePath {
  messageId: number
  alternatives: number
  entries: McaTraceEntry[]
  nodeIds: string[]
  pairKeys: string[]
}

const pairKey = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`

export function aggregateMcaTransitions(edges: McaEdge[]): McaTransition[] {
  const grouped = new Map<string, {
    sourceId: string
    targetId: string
    channelNames: Set<string>
    messageIds: Set<number>
    reachableMessageIds: Set<number>
    discoveryMessageIds: Set<number>
    constraintCount: number
    instanceCount: number
  }>()

  for (const edge of edges) {
    const sourceId = String(edge.source_component_id ?? edge.source)
    const targetId = String(edge.target_component_id ?? edge.target)
    const key = pairKey(sourceId, targetId)
    const group = grouped.get(key) ?? {
      sourceId,
      targetId,
      channelNames: new Set<string>(),
      messageIds: new Set<number>(),
      reachableMessageIds: new Set<number>(),
      discoveryMessageIds: new Set<number>(),
      constraintCount: 0,
      instanceCount: 0,
    }

    if (edge.message_type_name) group.channelNames.add(edge.message_type_name)
    if (Number.isFinite(edge.message_id)) group.messageIds.add(edge.message_id)
    if (edge.reachability === 'discovery_only' || edge.from_unconstrained_run) {
      group.discoveryMessageIds.add(edge.message_id)
    } else if (edge.reachability === 'reachable_from_configured_sources') {
      group.reachableMessageIds.add(edge.message_id)
    }
    group.constraintCount += edge.constraints?.length ?? 0
    group.instanceCount += 1
    grouped.set(key, group)
  }

  return [...grouped.entries()].map<McaTransition>(([id, group]) => ({
    id: `mca:${id}`,
    sourceId: group.sourceId,
    targetId: group.targetId,
    channelNames: [...group.channelNames].sort(),
    messageIds: [...group.messageIds].sort((a, b) => a - b),
    reachableMessageIds: [...group.reachableMessageIds].sort((a, b) => a - b),
    discoveryMessageIds: [...group.discoveryMessageIds].sort((a, b) => a - b),
    constraintCount: group.constraintCount,
    instanceCount: group.instanceCount,
    reachability: group.reachableMessageIds.size > 0
      ? 'reachable'
      : group.discoveryMessageIds.size > 0
        ? 'discovery_only'
        : 'unknown',
  })).sort((a, b) => a.id.localeCompare(b.id))
}

function longestTrace(paths: McaTraceEntry[][]): McaTraceEntry[] {
  return paths.reduce<McaTraceEntry[]>((longest, candidate) => (
    candidate.length > longest.length ? candidate : longest
  ), [])
}

export function getMcaTrace(artifact: McaArtifact, messageId: number): McaTracePath | null {
  const alternatives = artifact.traces?.[String(messageId)] ?? []
  const entries = longestTrace(alternatives)
  if (entries.length === 0) return null

  const componentIdByName = new Map(
    (artifact.components ?? artifact.nodes ?? []).map((component) => [component.name, String(component.id)]),
  )
  const componentByMessage = new Map(entries.map(([id, componentName]) => [id, componentIdByName.get(componentName)]))
  const nodeIds = new Set<string>()
  const pairKeys = new Set<string>()

  for (const [, componentName, inputMessageIds] of entries) {
    const targetId = componentIdByName.get(componentName)
    if (!targetId) continue
    nodeIds.add(targetId)
    for (const inputId of inputMessageIds) {
      const sourceId = componentByMessage.get(inputId)
      if (sourceId && sourceId !== targetId) pairKeys.add(pairKey(sourceId, targetId))
    }
  }

  return {
    messageId,
    alternatives: alternatives.length,
    entries,
    nodeIds: [...nodeIds],
    pairKeys: [...pairKeys],
  }
}

export function chooseBestTraceMessage(artifact: McaArtifact, messageIds: number[]): number | null {
  const reachability = new Map((artifact.messages ?? []).map((message) => [message.id, message.reachability]))
  let best: { id: number; reachable: boolean; length: number } | null = null

  for (const id of messageIds) {
    const paths = artifact.traces?.[String(id)] ?? []
    const candidate = {
      id,
      reachable: reachability.get(id) === 'reachable_from_configured_sources',
      length: longestTrace(paths).length,
    }
    if (!best
      || Number(candidate.reachable) > Number(best.reachable)
      || (candidate.reachable === best.reachable && candidate.length > best.length)) {
      best = candidate
    }
  }
  return best?.id ?? null
}

export function firstUnsafeWitness(artifact: McaArtifact): number | null {
  for (const finding of artifact.safety_findings ?? []) {
    if (finding.status === 'violated' && finding.reachable_violation_message_ids.length > 0) {
      return finding.reachable_violation_message_ids[0]
    }
  }
  return null
}
