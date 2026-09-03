import type { ReactNode } from 'react'

export function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>
}
