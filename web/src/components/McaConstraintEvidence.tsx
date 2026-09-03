import { useEffect, useMemo, useState } from 'react'
import { Braces, Check, Copy, FileCode2 } from 'lucide-react'
import {
  decodeAttitudeHex,
  explainConstraint,
  formatCapturedConstraint,
  preferredConstraintIndex,
} from '../graph/mcaConstraints'
import type { McaArtifact, McaConstraint, McaMessage, Profile, PropagationStatus } from '../types'
import { StatusPill } from './StatusPill'

interface ScenarioConstraintContext {
  title: string
  atSeconds: number
  kind: string
  sourceLabel: string
  targetLabel: string
  status: PropagationStatus
  enabled: boolean
  hasRelatedMcaTransition: boolean
}

interface McaConstraintEvidenceProps {
  artifact: McaArtifact
  profile: Profile
  records: McaConstraint[]
  preferredMessageId: number | null
  scopeLabel: string
  scenario?: ScenarioConstraintContext
  concreteMessage?: McaMessage | null
}

const humanize = (value: string) => value.replace(/^MSG_AFDX_VL_/, '').replaceAll('_', ' ').toLowerCase()

export function McaConstraintEvidence({
  artifact,
  profile,
  records,
  preferredMessageId,
  scopeLabel,
  scenario,
  concreteMessage,
}: McaConstraintEvidenceProps) {
  const recordKey = records.map((record) => record.message_id).join(',')
  const [recordIndex, setRecordIndex] = useState(() => preferredConstraintIndex(records, preferredMessageId))
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null)

  useEffect(() => {
    setRecordIndex(preferredConstraintIndex(records, preferredMessageId))
    setCopiedMessageId(null)
  }, [recordKey, preferredMessageId, records.length])

  const record = records[Math.min(recordIndex, Math.max(0, records.length - 1))]
  const explanation = record ? explainConstraint(record, profile) : null
  const componentNames = useMemo(() => new Map(
    (artifact.components ?? artifact.nodes ?? []).map((component) => [String(component.id), component.name]),
  ), [artifact])
  const decodedConcrete = concreteMessage?.data?.hex ? decodeAttitudeHex(concreteMessage.data.hex) : null

  const copyExactRecord = async () => {
    if (!record || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(formatCapturedConstraint(record))
      setCopiedMessageId(record.message_id)
    } catch {
      setCopiedMessageId(null)
    }
  }

  return (
    <section className="inspector-constraints" aria-label="Constraint evidence">
      {scenario && (
        <div className="scenario-constraint-card">
          <div className="constraint-heading">
            <div><span>Configured scenario condition</span><strong>{scenario.title}</strong></div>
            <em>Not MCA-derived</em>
          </div>
          <div className="scenario-guard-expression">
            <code>scenario armed</code><b>AND</b><code>time ≥ T+{scenario.atSeconds}s</code>
          </div>
          <p>{scenario.sourceLabel} → {scenario.targetLabel} · {scenario.kind}. This dotted runtime edge comes from the selected attack configuration, not from symbolic execution.</p>
          <div className="scenario-constraint-status">
            <StatusPill tone={scenario.status}>{scenario.status}</StatusPill>
            <span>{scenario.enabled ? 'Scenario is armed' : 'Scenario is not armed'}</span>
          </div>
          {scenario.hasRelatedMcaTransition
            ? <small>A parallel solid MCA transition exists. Its captured binary evidence is shown below.</small>
            : <small>No analyzed binary transition has the same source and target; select a solid MCA edge for native predicates.</small>}
        </div>
      )}

      {concreteMessage && (
        <div className="concrete-evidence-card">
          <div className="constraint-heading">
            <div><span>Concrete witness value</span><strong>{humanize(concreteMessage.type?.name ?? `message ${concreteMessage.id}`)} #{concreteMessage.id}</strong></div>
            <em>Reachable</em>
          </div>
          <code className="concrete-payload">{concreteMessage.data?.hex ?? concreteMessage.data?.unsigned_decimal ?? 'value unavailable'}</code>
          {decodedConcrete && (
            <dl>
              <div><dt>Pitch</dt><dd>{decodedConcrete.pitchDeg.toFixed(1)}°</dd></div>
              <div><dt>Roll</dt><dd>{decodedConcrete.rollDeg > 0 ? '+' : ''}{decodedConcrete.rollDeg.toFixed(1)}°</dd></div>
              <div><dt>Heading</dt><dd>{decodedConcrete.headingDeg.toFixed(1)}°</dd></div>
              <div><dt>Flags</dt><dd>{decodedConcrete.flags.join(', ') || 'none'}</dd></div>
            </dl>
          )}
          <p>This terminal value is concrete, so it has no symbolic constraint record. The nearest upstream payload constraints remain available below.</p>
        </div>
      )}

      <div className="constraint-section-heading">
        <div><Braces size={15} /><span>{scenario ? 'Related MCA evidence' : 'Constraint evidence'}</span></div>
        <em>angr / Claripy</em>
      </div>

      {records.length > 0 && record && explanation ? (
        <>
          <div className="constraint-scope-row">
            <span>{scopeLabel}</span>
            <strong>{records.length} alternative record{records.length === 1 ? '' : 's'}</strong>
          </div>

          <label className="constraint-message-select">
            <span>Message instance</span>
            <select value={recordIndex} onChange={(event) => setRecordIndex(Number(event.target.value))}>
              {records.map((candidate, index) => (
                <option value={index} key={candidate.message_id}>
                  #{candidate.message_id} · {humanize(candidate.message_type_name ?? 'message')} · {candidate.reachability === 'reachable_from_configured_sources' ? 'reachable' : 'discovery only'}
                </option>
              ))}
            </select>
          </label>

          <article className="constraint-explanation-card">
            <div className="explanation-kicker"><span>Readable decoding</span><em>{explanation.decoded ? 'Known aviation contract' : 'Conservative fallback'}</em></div>
            <h4>{explanation.title}</h4>
            <p>{explanation.summary}</p>
            <div className="constraint-logic">
              <b>{(record.predicates?.length ?? 0) > 0 ? 'ALL' : 'NO EXTRA'}</b>
              <span>{(record.predicates?.length ?? 0) > 0
                ? `${record.predicates?.length} predicates inside this message record are conjunctive.`
                : 'No additional payload-relevant predicate was captured for this symbolic record.'}</span>
            </div>
            <ul>
              {explanation.conditions.map((condition) => <li key={condition}>{condition}</li>)}
            </ul>
            <div className="constraint-outcome"><Check size={13} /><span>{explanation.outcome}</span></div>
            <small>Presentation aid only. The full captured Claripy record below is authoritative; different message records are alternative paths.</small>
          </article>

          <details className="constraint-raw">
            <summary><span><FileCode2 size={14} /> Full captured record</span><strong>{record.predicates?.length ?? 0} predicate{record.predicates?.length === 1 ? '' : 's'}</strong></summary>
            <div className="constraint-raw-body">
              <p>Exact payload-relevant rendering stored by the analyzer. This is diagnostic Claripy text, not a rewritten or solver-checked simplification.</p>
              <dl>
                <div><dt>Message</dt><dd>#{record.message_id} · {record.message_type_name ?? 'unknown type'}</dd></div>
                <div><dt>Producer</dt><dd>{componentNames.get(String(record.producer_component_id)) ?? record.producer_component_id}</dd></div>
                <div><dt>Reachability</dt><dd>{record.reachability.replaceAll('_', ' ')}</dd></div>
                <div><dt>Variables</dt><dd>{record.variables?.join(', ') || 'none'}</dd></div>
              </dl>
              <label>Payload expression</label>
              <pre>{record.payload_expression ?? 'concrete payload'}</pre>
              <label>Path predicates — all must hold</label>
              {(record.predicates ?? []).length > 0
                ? <ol>{record.predicates?.map((predicate, index) => (
                    <li key={`${predicate.text}-${index}`}><span>P{index + 1} · {predicate.format ?? 'claripy-str'}</span><pre>{predicate.text}</pre></li>
                  ))}</ol>
                : <div className="constraint-no-predicates">No additional payload-relevant predicates captured.</div>}
              <button className="constraint-copy" type="button" onClick={() => void copyExactRecord()} aria-label={`Copy full captured constraint for message ${record.message_id}`}>
                {copiedMessageId === record.message_id ? <Check size={13} /> : <Copy size={13} />}
                {copiedMessageId === record.message_id ? 'Copied exact record' : 'Copy exact record'}
              </button>
              <span className="sr-only" role="status">{copiedMessageId === record.message_id ? `Copied constraint record for message ${record.message_id}` : ''}</span>
            </div>
          </details>
        </>
      ) : (
        <div className="constraint-empty-note">
          <strong>No symbolic payload record in this scope</strong>
          <span>{concreteMessage
            ? 'The selected terminal is concrete; its decoded value is shown above.'
            : scenario && !scenario.hasRelatedMcaTransition
              ? 'The dotted scenario transition is configured evidence, not an analyzed message.'
              : 'This component or transition emitted no symbolic payload constraint record.'}</span>
        </div>
      )}
    </section>
  )
}
