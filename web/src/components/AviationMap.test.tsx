import { describe, expect, it } from 'vitest'
import { aircraftMarkerHtml } from './AviationMap'

describe('aircraft map marker', () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [-1, 359],
    [361, 1],
  ])('rotates a north-authored silhouette from aviation heading %s', (heading, expected) => {
    const html = aircraftMarkerHtml(heading, 'true')
    expect(html).toContain(`rotate(${expected}deg)`)
    expect(html).toContain('viewBox="0 0 32 32"')
    expect(html).toContain('class="aircraft-silhouette true"')
    expect(html).not.toContain('✈')
  })
})
