import { fallbackConfig } from './data/fallback'
import type { InverseReachabilityResult, InverseTarget, McaArtifact, Profile, PublicConfig, ReachabilityResult, SafetyLimits } from './types'

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const payload = await response.json() as { error?: string; detail?: string }
      detail = payload.detail ?? payload.error ?? detail
    } catch {
      // Preserve the HTTP status when an upstream error is not JSON.
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export async function loadConfig(): Promise<{ config: PublicConfig; offline: boolean }> {
  try {
    return { config: await jsonRequest<PublicConfig>('/api/config'), offline: false }
  } catch {
    return { config: fallbackConfig, offline: true }
  }
}

export async function loadAnalysis(profile: Profile): Promise<McaArtifact> {
  const staticPath = `/analysis/aviation-${profile}.json`
  try {
    return await jsonRequest<McaArtifact>(staticPath)
  } catch (staticError) {
    try {
      return await jsonRequest<McaArtifact>(`/api/analysis/${profile}`)
    } catch {
      throw staticError
    }
  }
}

export async function runAnalysis(): Promise<unknown> {
  return jsonRequest('/api/analysis/run', {
    method: 'POST',
    body: JSON.stringify({ profiles: ['secure', 'vulnerable'] }),
  })
}

export async function computeReachability(
  attackIds: string[],
  safety: SafetyLimits,
  horizonSeconds: number,
  stepSeconds: number,
): Promise<ReachabilityResult> {
  return jsonRequest('/api/reachability', {
    method: 'POST',
    body: JSON.stringify({
      attack_ids: attackIds,
      safety,
      horizon_seconds: horizonSeconds,
      step_seconds: stepSeconds,
    }),
  })
}

export async function computeInverseReachability(
  target: InverseTarget,
  attackIds?: string[],
  horizonSeconds = 120,
  stepSeconds = 6,
): Promise<InverseReachabilityResult> {
  return jsonRequest('/api/inverse-reachability', {
    method: 'POST',
    body: JSON.stringify({
      target,
      ...(attackIds === undefined ? {} : { attack_ids: attackIds }),
      horizon_seconds: horizonSeconds,
      step_seconds: stepSeconds,
    }),
  })
}
