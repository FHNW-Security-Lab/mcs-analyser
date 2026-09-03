import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { AircraftState, EnvelopeSample, GeoPoint, Profile, Route } from '../types'
import { destinationPoint, envelopePolygon, haversineMeters, localOffsetOnRoute, normalizeHeading } from '../sim/geo'
import 'leaflet/dist/leaflet.css'

interface AviationMapProps {
  profile: Profile
  route: Route
  state: AircraftState
  history: AircraftState[]
  envelope?: EnvelopeSample[]
  maxCourseDeviationNm: number
}

function FitRoute({ route }: { route: Route }) {
  const map = useMap()
  const signature = route.points.map((point) => `${point.lat},${point.lon}`).join(';')
  useEffect(() => {
    const bounds = L.latLngBounds(route.points.map((point) => [point.lat, point.lon] as [number, number]))
    map.fitBounds(bounds, { padding: [25, 25], animate: false })
  }, [map, signature, route.points])
  return null
}

export function aircraftMarkerHtml(heading: number, kind: 'true' | 'estimate'): string {
  const normalizedHeading = normalizeHeading(heading)
  return `<svg class="aircraft-silhouette ${kind}" viewBox="0 0 32 32" style="transform:rotate(${normalizedHeading}deg)" role="presentation" aria-hidden="true"><path d="M16 1.5c-1.25 0-2.1 1.45-2.1 3.1v6.6L3.5 17.4v3.2l10.4-3v7.15l-4.2 3.05V30l6.3-1.85L22.3 30v-2.2l-4.2-3.05V17.6l10.4 3v-3.2l-10.4-6.2V4.6c0-1.65-.85-3.1-2.1-3.1Z"/></svg>`
}

function aircraftIcon(profile: Profile, heading: number, kind: 'true' | 'estimate') {
  return L.divIcon({
    className: `aircraft-map-icon ${profile} ${kind}`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: aircraftMarkerHtml(heading, kind),
  })
}

const verticalSpeedLabel = (verticalSpeedFpm: number) => {
  const arrow = verticalSpeedFpm > 100 ? '↑' : verticalSpeedFpm < -100 ? '↓' : '→'
  const sign = verticalSpeedFpm > 0 ? '+' : verticalSpeedFpm < 0 ? '−' : ''
  return `${arrow} ${sign}${Math.abs(Math.round(verticalSpeedFpm / 10) * 10).toLocaleString()} fpm`
}

const positions = (points: GeoPoint[]): [number, number][] => points.map((point) => [point.lat, point.lon])

export function AviationMap({ profile, route, state, history, envelope, maxCourseDeviationNm }: AviationMapProps) {
  const routePositions = positions(route.points)
  const trueTrack = positions(history.map((item) => item.truePosition))
  const estimateTrack = positions(history.map((item) => item.estimatedPosition))
  const estimateSeparated = haversineMeters(state.truePosition, state.estimatedPosition) > 80
  const headingVectorEnd = destinationPoint(state.truePosition, 5_000, state.headingDeg)
  const trueIcon = useMemo(() => aircraftIcon(profile, state.headingDeg, 'true'), [profile, state.headingDeg])
  const estimateIcon = useMemo(() => aircraftIcon(profile, state.headingDeg, 'estimate'), [profile, state.headingDeg])
  const tube = useMemo(() => envelopePolygon(route, envelope ?? []), [route, envelope])
  const corridor = useMemo(() => {
    const crossM = maxCourseDeviationNm * 1852
    const length = route.points.slice(1).reduce((total, point, index) => {
      const from = route.points[index]
      const latScale = 111_132
      const lonScale = 111_320 * Math.cos(((from.lat + point.lat) / 2) * Math.PI / 180)
      return total + Math.hypot((point.lat - from.lat) * latScale, (point.lon - from.lon) * lonScale)
    }, 0)
    const samples = Array.from({ length: 30 }, (_, index) => length * index / 29)
    return {
      left: positions(samples.map((along) => localOffsetOnRoute(route, along, -crossM))),
      right: positions(samples.map((along) => localOffsetOnRoute(route, along, crossM))),
    }
  }, [route, maxCourseDeviationNm])

  const accent = profile === 'secure' ? '#4fd1b5' : '#f07d63'

  return (
    <section className={`map-card panel profile-${profile}`}>
      <header className="map-card-header">
        <div>
          <span className="eyebrow">{profile} trajectory</span>
          <h3>{route.origin} <span>→</span> {route.destination}</h3>
        </div>
        <div className="map-live-values">
          <span><i className="legend-line solid" style={{ background: accent }} /> True</span>
          <span><i className="legend-line dashed" style={{ borderColor: accent }} /> Estimated</span>
          <span><i className="legend-area" style={{ background: accent }} /> Reach tube</span>
        </div>
      </header>
      <div className="map-shell" aria-label={`${profile} aircraft geographic trajectory map`}>
        <MapContainer center={routePositions[0]} zoom={8} zoomControl={false} attributionControl className="map-canvas">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitRoute route={route} />
          {tube.length > 2 && <Polygon positions={positions(tube)} pathOptions={{ color: accent, fillColor: accent, fillOpacity: 0.14, weight: 1 }} />}
          <Polyline positions={corridor.left} pathOptions={{ color: '#e3b564', opacity: 0.44, weight: 1, dashArray: '4 8' }} />
          <Polyline positions={corridor.right} pathOptions={{ color: '#e3b564', opacity: 0.44, weight: 1, dashArray: '4 8' }} />
          <Polyline positions={routePositions} pathOptions={{ color: '#afbdc4', weight: 2, opacity: 0.7, dashArray: '3 7' }} />
          {trueTrack.length > 1 && <Polyline positions={trueTrack} pathOptions={{ color: accent, weight: 3.4, opacity: 0.95 }} />}
          {estimateTrack.length > 1 && <Polyline positions={estimateTrack} pathOptions={{ color: accent, weight: 2, opacity: 0.72, dashArray: '7 7' }} />}
          <Polyline positions={positions([state.truePosition, headingVectorEnd])} pathOptions={{ color: accent, weight: 2, opacity: 0.8, dashArray: '2 7' }} />
          {route.points.map((point, index) => (
            <CircleMarker
              key={point.id}
              center={[point.lat, point.lon]}
              radius={index === 0 || index === route.points.length - 1 ? 5 : 3}
              pathOptions={{ color: '#ccd8dd', fillColor: '#071116', fillOpacity: 1, weight: 1.5 }}
            >
              <Tooltip direction="top">{point.id} · {point.label}<br />{point.altitude_ft.toLocaleString()} ft</Tooltip>
            </CircleMarker>
          ))}
          {estimateSeparated && (
            <Marker position={[state.estimatedPosition.lat, state.estimatedPosition.lon]} icon={estimateIcon} opacity={0.5}>
              <Tooltip permanent direction="right" offset={[17, 0]}>EST</Tooltip>
            </Marker>
          )}
          <Marker position={[state.truePosition.lat, state.truePosition.lon]} icon={trueIcon}>
            <Tooltip permanent direction="top" offset={[0, -20]} className={`aircraft-flight-label ${profile}`}>
              <strong>{profile === 'secure' ? 'ALB-S' : 'ALB-V'} · {state.flightPhase}</strong>
              <span>{Math.round(state.altitudeFt).toLocaleString()} ft · {verticalSpeedLabel(state.verticalSpeedFpm)}</span>
            </Tooltip>
            <Popup>
              <strong>{profile === 'secure' ? 'ALB Secure' : 'ALB Vulnerable'}</strong><br />
              {state.truePosition.lat.toFixed(5)}, {state.truePosition.lon.toFixed(5)}<br />
              {Math.round(state.altitudeFt).toLocaleString()} ft · {state.navMode}
            </Popup>
          </Marker>
        </MapContainer>
        <div className="map-coordinate-chip">
          WGS84&nbsp; {state.truePosition.lat.toFixed(5)}°N&nbsp; {state.truePosition.lon.toFixed(5)}°E
        </div>
      </div>
    </section>
  )
}
