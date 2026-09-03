import { describe, expect, it } from 'vitest'
import { destinationPoint, haversineMeters, initialBearing, localOffsetOnRoute, routeLength, routePointAtDistance } from './geo'
import { fallbackConfig } from '../data/fallback'

describe('WGS84 route helpers', () => {
  const route = fallbackConfig.routes[0]

  it('computes a plausible real route length', () => {
    expect(routeLength(route)).toBeGreaterThan(100_000)
    expect(routeLength(route)).toBeLessThan(140_000)
  })

  it('round-trips a geodesic destination within metres', () => {
    const origin = { lat: 52.362137, lon: 13.50007 }
    const destination = destinationPoint(origin, 10_000, 225)
    expect(haversineMeters(origin, destination)).toBeCloseTo(10_000, 3)
    expect(initialBearing(origin, destination)).toBeCloseTo(225, 5)
  })

  it('interpolates along route geometry and altitude', () => {
    const start = routePointAtDistance(route, 0)
    const end = routePointAtDistance(route, routeLength(route))
    expect(start.lat).toBeCloseTo(route.points[0].lat, 6)
    expect(end.lon).toBeCloseTo(route.points.at(-1)!.lon, 6)
    expect(end.altitudeFt).toBeCloseTo(route.points.at(-1)!.altitude_ft, 4)
  })

  it('applies signed cross-track displacement perpendicular to course', () => {
    const center = localOffsetOnRoute(route, 25_000, 0)
    const right = localOffsetOnRoute(route, 25_000, 1852)
    expect(haversineMeters(center, right)).toBeCloseTo(1852, 3)
  })
})
