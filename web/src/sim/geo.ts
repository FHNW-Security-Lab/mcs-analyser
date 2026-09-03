import type { EnvelopeSample, GeoPoint, Route } from '../types'

export const EARTH_RADIUS_M = 6_371_008.8
const TO_RAD = Math.PI / 180
const TO_DEG = 180 / Math.PI

export const normalizeHeading = (degrees: number): number => ((degrees % 360) + 360) % 360

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const lat1 = a.lat * TO_RAD
  const lat2 = b.lat * TO_RAD
  const dLat = (b.lat - a.lat) * TO_RAD
  const dLon = (b.lon - a.lon) * TO_RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function initialBearing(a: GeoPoint, b: GeoPoint): number {
  const lat1 = a.lat * TO_RAD
  const lat2 = b.lat * TO_RAD
  const dLon = (b.lon - a.lon) * TO_RAD
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return normalizeHeading(Math.atan2(y, x) * TO_DEG)
}

export function destinationPoint(origin: GeoPoint, distanceM: number, bearingDeg: number): GeoPoint {
  const delta = distanceM / EARTH_RADIUS_M
  const theta = bearingDeg * TO_RAD
  const phi1 = origin.lat * TO_RAD
  const lambda1 = origin.lon * TO_RAD
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)))
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1)
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
  const lambda2 = lambda1 + Math.atan2(y, x)
  return {
    lat: phi2 * TO_DEG,
    lon: ((((lambda2 * TO_DEG) + 540) % 360) - 180),
  }
}

export interface RouteSample extends GeoPoint {
  altitudeFt: number
  headingDeg: number
  segmentIndex: number
  fraction: number
}

export function routeLength(route: Route): number {
  return route.points.slice(1).reduce((sum, point, index) => sum + haversineMeters(route.points[index], point), 0)
}

export function routePointAtDistance(route: Route, distanceM: number): RouteSample {
  if (route.points.length < 2) throw new Error('A route requires at least two points')
  const total = routeLength(route)
  let remaining = Math.max(0, Math.min(distanceM, total))

  for (let index = 0; index < route.points.length - 1; index += 1) {
    const start = route.points[index]
    const end = route.points[index + 1]
    const segmentLength = haversineMeters(start, end)
    if (remaining <= segmentLength || index === route.points.length - 2) {
      const fraction = segmentLength > 0 ? Math.min(1, remaining / segmentLength) : 0
      const bearing = initialBearing(start, end)
      const position = destinationPoint(start, segmentLength * fraction, bearing)
      return {
        ...position,
        altitudeFt: start.altitude_ft + (end.altitude_ft - start.altitude_ft) * fraction,
        headingDeg: bearing,
        segmentIndex: index,
        fraction,
      }
    }
    remaining -= segmentLength
  }

  const end = route.points.at(-1)!
  const previous = route.points.at(-2)!
  return {
    lat: end.lat,
    lon: end.lon,
    altitudeFt: end.altitude_ft,
    headingDeg: initialBearing(previous, end),
    segmentIndex: route.points.length - 2,
    fraction: 1,
  }
}

export function localOffsetOnRoute(route: Route, alongM: number, crossM: number): RouteSample {
  const base = routePointAtDistance(route, alongM)
  const offset = destinationPoint(base, crossM, base.headingDeg + 90)
  return { ...base, ...offset }
}

export function envelopePolygon(route: Route, envelope: EnvelopeSample[]): GeoPoint[] {
  if (envelope.length < 2) return []
  const left = envelope.map((sample) => localOffsetOnRoute(route, sample.along_min_m, sample.cross_min_m))
  const right = [...envelope]
    .reverse()
    .map((sample) => localOffsetOnRoute(route, sample.along_max_m, sample.cross_max_m))
  return [...left, ...right]
}

export function signedDegrees(value: number, digits = 1): string {
  const normalized = Math.abs(value) < 10 ** -(digits + 1) ? 0 : value
  return `${normalized >= 0 ? '+' : '−'}${Math.abs(normalized).toFixed(digits)}°`
}

export const metersToNm = (meters: number): number => meters / 1852
export const feetToMeters = (feet: number): number => feet * 0.3048
export const metersToFeet = (meters: number): number => meters / 0.3048
