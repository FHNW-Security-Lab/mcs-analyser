import type { McaArtifact, McaConstraint, McaMessage, McaTraceEntry, Profile } from '../types'
import type { McaTransition } from './mcaTopology'

export interface ConstraintExplanation {
  title: string
  summary: string
  conditions: string[]
  outcome: string
  decoded: boolean
}

export interface DecodedAttitudePayload {
  pitchDeg: number
  rollDeg: number
  headingDeg: number
  flags: string[]
}

const humanize = (value: string) => value.replace(/^MSG_AFDX_VL_/, '').replaceAll('_', ' ').toLowerCase()

function deduplicate(records: McaConstraint[]): McaConstraint[] {
  const seen = new Set<number>()
  return records.filter((record) => {
    if (seen.has(record.message_id)) return false
    seen.add(record.message_id)
    return true
  })
}

function synthesizeConstraintRecord(artifact: McaArtifact, messageId: number): McaConstraint | null {
  const message = artifact.messages?.find((candidate) => candidate.id === messageId)
  const edge = (artifact.communication_edges ?? artifact.edges ?? []).find((candidate) => candidate.message_id === messageId)
  if (!message && !edge) return null
  const predicates = message?.data?.constraints ?? edge?.constraints ?? []
  if (message?.data?.kind !== 'symbolic' && predicates.length === 0) return null
  return {
    message_id: messageId,
    producer_component_id: message?.producer_component_id ?? edge?.source_component_id ?? 'unknown',
    message_type_id: message?.type?.id ?? edge?.message_type_id ?? 0,
    message_type_name: message?.type?.name ?? edge?.message_type_name,
    reachability: message?.reachability ?? edge?.reachability ?? 'unknown',
    payload_expression: message?.data?.expression,
    variables: message?.data?.variables ?? [...new Set(predicates.flatMap((predicate) => predicate.variables ?? []))],
    predicates,
  }
}

export function constraintRecordsForMessageIds(artifact: McaArtifact, messageIds: number[]): McaConstraint[] {
  const recordByMessage = new Map((artifact.constraints ?? []).map((record) => [record.message_id, record]))
  return deduplicate(messageIds.flatMap((messageId) => {
    const record = recordByMessage.get(messageId) ?? synthesizeConstraintRecord(artifact, messageId)
    return record ? [record] : []
  }))
}

export function constraintRecordsForTransition(artifact: McaArtifact, transition: McaTransition): McaConstraint[] {
  return constraintRecordsForMessageIds(artifact, transition.messageIds)
}

export function constraintRecordsForComponent(artifact: McaArtifact, componentId: string): McaConstraint[] {
  return deduplicate((artifact.constraints ?? []).filter((record) => String(record.producer_component_id) === componentId))
}

export function constraintRecordsForTrace(artifact: McaArtifact, entries: McaTraceEntry[]): McaConstraint[] {
  return constraintRecordsForMessageIds(artifact, entries.map(([messageId]) => messageId))
}

export function preferredConstraintIndex(records: McaConstraint[], preferredMessageId: number | null): number {
  if (records.length === 0) return 0
  if (preferredMessageId !== null) {
    const exact = records.findIndex((record) => record.message_id === preferredMessageId)
    if (exact >= 0) return exact
  }
  const reachable = records.findIndex((record) => record.reachability === 'reachable_from_configured_sources')
  return reachable >= 0 ? reachable : 0
}

function rule(
  title: string,
  summary: string,
  conditions: string[],
  outcome: string,
): ConstraintExplanation {
  return { title, summary, conditions, outcome, decoded: true }
}

export function explainConstraint(record: McaConstraint, profile: Profile): ConstraintExplanation {
  const type = record.message_type_name ?? `message #${record.message_id}`
  const outcome = `${humanize(type)} message #${record.message_id} can be emitted on this path.`

  switch (type) {
    case 'MSG_AFDX_VL_GNSS_POSITION':
      return rule('Valid GNSS coordinate', 'The receiver treats the 64-bit payload as a WGS-84 coordinate.', [
        'Latitude [63:32], signed microdegrees: −90° to +90°.',
        'Longitude [31:0], signed microdegrees: −180° to +180°.',
      ], outcome)
    case 'MSG_AFDX_VL_INS_POSITION':
      return rule('INS operating-region fix', 'The inertial solution is accepted only inside the configured European operating region.', [
        'Latitude: 47° to 55° north.',
        'Longitude: 5° to 16° east.',
      ], outcome)
    case 'MSG_AFDX_VL_RADIO_POSITION':
      return rule('Radio-navigation coverage fix', 'The DME/DME or VOR/DME solution must remain inside the regional navaid network.', [
        'Latitude: 48° to 54.5° north.',
        'Longitude: 6° to 15.5° east.',
      ], outcome)
    case 'MSG_AFDX_VL_AIR_DATA':
      return rule('Plausible air-data sample', 'Packed altitude, vertical speed, and indicated airspeed must all pass the sensor plausibility check.', [
        'Altitude: −2,000 to 60,000 ft.',
        'Vertical speed: −10,000 to +10,000 ft/min.',
        'Indicated airspeed: 40 to 650 kt.',
      ], outcome)
    case 'MSG_AFDX_VL_ATTITUDE':
      return rule('Plausible attitude sample', 'The attitude and heading reference validates every decoded field.', [
        'Pitch: −90° to +90°.',
        'Roll: −180° to +180°.',
        'Heading: 0° inclusive to 360° exclusive.',
      ], outcome)
    case 'MSG_AFDX_VL_WEATHER':
      return rule('Bounded weather report', 'The radar publishes weather only when all encoded fields are inside their declared ranges.', [
        'Wind: no more than 250 kt.',
        'Turbulence level: 0 to 3.',
        'Icing level: 0 to 3.',
      ], outcome)
    case 'MSG_AFDX_VL_NAV_SOLUTION':
      return profile === 'secure'
        ? rule('Three-source navigation vote', 'The secure fusion selects a route-consistent position only after independent corroboration.', [
            'The selected fix is inside the narrow route-consistency monitor.',
            'INS must agree with radio or GNSS; radio plus GNSS is the degraded fallback.',
            (record.predicates?.length ?? 0) > 0
              ? `All ${record.predicates?.length} captured payload predicates for this message hold together.`
              : 'No additional payload-relevant predicate was captured for this symbolic record.',
          ], outcome)
        : rule('GNSS granted navigation authority', 'The vulnerable fusion copies a syntactically valid GNSS payload directly into the navigation solution.', [
            'The incoming label is GNSS position.',
            'No independent INS or radio consistency predicate is added by this component.',
            (record.predicates?.length ?? 0) > 0
              ? `All ${record.predicates?.length} captured payload predicates are inherited from the GNSS fix.`
              : 'No additional payload-relevant predicate was captured for this symbolic record.',
          ], outcome)
    case 'MSG_AFDX_VL_NAV_DEGRADED_SOLUTION':
      return rule('Degraded but corroborated solution', 'The secure voter found a valid position while at least one independent source was unavailable or inconsistent.', [
        'A route-consistent pair still supports the selected fix.',
        'The degraded status is retained for downstream handling.',
      ], outcome)
    case 'MSG_AFDX_VL_NAV_REJECT':
      return rule('Navigation input rejected', profile === 'secure'
        ? 'The secure fusion cannot form a corroborated route-consistent solution.'
        : 'The vulnerable fusion received a GNSS alert rather than a valid position.', [
        'This is a rejection branch, separate from each feasible solution record.',
      ], outcome)
    case 'MSG_AFDX_VL_FMS_TRACK_POSITION':
      return rule('FMS lateral-error branch', 'The FMS preserves the accepted position while selecting bank demand from longitude error relative to the route reference.', [
        'Error bands are ±0.02°, ±0.36°, and ±1.00° longitude.',
        'The outer band requests ±70° bank and sets NAV_DIRECT; inner bands request 0°, ±15°, or ±45°.',
        'The exact interval for this message instance is retained in the raw predicates.',
      ], outcome)
    case 'MSG_AFDX_VL_FLIGHT_GUIDANCE':
      return rule('Guidance command branch', 'Guidance either preserves an FMS target or applies bounded attitude feedback.', [
        'Feedback correction is bounded to ±12° pitch and ±25° roll.',
        'FMS authority and mode flags are preserved on the pass-through branch.',
      ], outcome)
    case 'MSG_AFDX_VL_ENVELOPE_COMMAND':
      return profile === 'secure'
        ? rule('Protected flight-envelope command', 'The secure limiter always constrains the command before it reaches the actuator.', [
            'Pitch is clamped to ±18°.',
            'Roll is clamped to ±32°.',
            'A limit event sets the ENVELOPE_LIMITED flag and emits an alert.',
          ], outcome)
        : rule('Direct-law bypass branch', 'The vulnerable limiter applies normal bounds only when NAV_DIRECT is clear.', [
            'Normal branch: pitch is clamped to ±18° and roll to ±32°.',
            'NAV_DIRECT branch: the command bypasses those software limits.',
            'The exact flag and numeric branch for this message is shown in the raw predicates.',
          ], outcome)
    case 'MSG_AFDX_VL_ACTUATOR_COMMAND':
      return rule('Mechanical travel accepted', 'The independent actuator monitor accepts a wider mechanical range than the intended flight envelope.', [
        'Pitch command: −25° to +25°.',
        'Roll command: −70° to +70°.',
        'This wider range explains why a bypassed ±70° bank can reach the aircraft effect.',
      ], outcome)
    case 'MSG_AFDX_VL_ACTUATOR_ALERT':
      return rule('Actuator command rejected', 'The mechanical travel monitor rejected the command or forwarded an upstream envelope alert.', [
        'This alert path is an alternative to an accepted actuator command.',
      ], outcome)
    case 'MSG_AFDX_VL_AIRCRAFT_ATTITUDE_STATE':
      return rule('Attitude remains inside the safety envelope', 'The aircraft-effect observer classifies the received command as safe.', [
        'Pitch remains inside ±18°.',
        'Roll remains inside ±32°.',
      ], outcome)
    case 'MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE':
      return rule('Unsafe attitude witness', 'The aircraft-effect observer found an envelope violation.', [
        'Pitch is outside ±18°, or roll is outside ±32°.',
        'Different messages represent alternative violating branches; they are not combined.',
      ], outcome)
    case 'MSG_AFDX_VL_AIRCRAFT_POSITION_STATE':
      return rule('Position remains in route monitor', 'The tracked position is inside the configured geographic corridor.', [
        'Latitude: 52.519603° to 52.520413° north.',
        'Longitude: 13.404294° to 13.405614° east.',
      ], outcome)
    case 'MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE':
      return rule('Route-monitor violation', 'The tracked position lies outside the configured geographic corridor.', [
        'Latitude or longitude violates at least one route-monitor bound.',
        'The raw record identifies the exact alternative branch.',
      ], outcome)
    default:
      return {
        title: 'Symbolic message condition',
        summary: 'The analyzer captured a payload relation for this feasible component path.',
        conditions: [record.predicates?.length
          ? `All ${record.predicates.length} captured predicates in this record must hold together.`
          : 'The symbolic payload has no additional payload-relevant predicate in the captured record.'],
        outcome,
        decoded: false,
      }
  }
}

function signed16(value: bigint): number {
  const raw = Number(value & 0xffffn)
  return raw >= 0x8000 ? raw - 0x10000 : raw
}

export function decodeAttitudeHex(hex: string): DecodedAttitudePayload | null {
  try {
    const payload = BigInt(hex)
    const pitchDeg = signed16(payload >> 48n) / 100
    const rollDeg = signed16(payload >> 32n) / 100
    const headingDeg = Number((payload >> 16n) & 0xffffn) / 100
    const rawFlags = Number(payload & 0xffffn)
    const flags = [
      rawFlags & 0x1 ? 'NAV_DIRECT' : '',
      rawFlags & 0x2 ? 'ENVELOPE_LIMITED' : '',
      rawFlags & 0x4 ? 'TURBULENCE' : '',
      rawFlags & 0x8 ? 'SENSOR_RECOVERY' : '',
    ].filter(Boolean)
    return { pitchDeg, rollDeg, headingDeg, flags }
  } catch {
    return null
  }
}

export function concreteMessageById(artifact: McaArtifact, messageId: number | null): McaMessage | null {
  if (messageId === null) return null
  const message = artifact.messages?.find((candidate) => candidate.id === messageId)
  return message?.data?.kind === 'concrete' ? message : null
}

export function formatCapturedConstraint(record: McaConstraint): string {
  const predicates = record.predicates ?? []
  return [
    `Message #${record.message_id}: ${record.message_type_name ?? 'unknown type'}`,
    `Producer: ${record.producer_component_id}`,
    `Reachability: ${record.reachability}`,
    `Variables: ${record.variables?.join(', ') || 'none'}`,
    `Payload expression: ${record.payload_expression ?? 'concrete payload'}`,
    '',
    ...(predicates.length
      ? predicates.map((predicate, index) => `P${index + 1} [${predicate.format ?? 'claripy-str'}]\n${predicate.text}`)
      : ['No additional payload-relevant predicates were captured for this symbolic record.']),
  ].join('\n')
}
