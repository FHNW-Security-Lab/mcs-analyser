import { ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { SafetyLimits } from '../types'

interface SafetyControlsProps {
  limits: SafetyLimits
  onChange: (limits: SafetyLimits) => void
}

const fields: Array<{ key: keyof SafetyLimits; label: string; unit: string; min: number; max: number; step: number }> = [
  { key: 'max_roll_deg', label: 'Maximum roll', unit: 'deg', min: 5, max: 60, step: 1 },
  { key: 'max_pitch_deg', label: 'Maximum pitch', unit: 'deg', min: 5, max: 40, step: 1 },
  { key: 'max_yaw_rate_deg_s', label: 'Maximum yaw rate', unit: 'deg/s', min: 0.5, max: 8, step: 0.1 },
  { key: 'max_course_deviation_nm', label: 'Course deviation', unit: 'NM', min: 0.1, max: 10, step: 0.1 },
  { key: 'max_altitude_deviation_ft', label: 'Altitude deviation', unit: 'ft', min: 100, max: 5000, step: 100 },
]

export function SafetyControls({ limits, onChange }: SafetyControlsProps) {
  return (
    <section className="panel safety-controls">
      <header className="panel-header">
        <div>
          <span className="eyebrow"><ShieldCheck size={13} /> Runtime safety predicates</span>
          <h2>Dynamic safety envelope</h2>
        </div>
        <SlidersHorizontal size={18} className="muted-icon" />
      </header>
      <div className="safety-grid">
        {fields.map((field) => (
          <label className="safety-field" key={field.key}>
            <span>{field.label}</span>
            <div>
              <input
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={limits[field.key]}
                onChange={(event) => onChange({ ...limits, [field.key]: Number(event.target.value) })}
              />
              <small>{field.unit}</small>
            </div>
          </label>
        ))}
      </div>
    </section>
  )
}
