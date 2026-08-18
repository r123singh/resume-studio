import type { ComponentType } from 'react'
import { Tooltip } from './ui/Tooltip'

export type RailItem<T extends string> = {
  id: T
  icon: ComponentType<{ size?: number | string; strokeWidth?: number | string }>
  label: string
  shortcut?: string
  badge?: boolean
}

type Props<T extends string> = {
  items: RailItem<T>[]
  active: T | null
  onSelect: (id: T) => void
  side?: 'left' | 'right'
  footer?: React.ReactNode
  ariaLabel: string
}

/**
 * Vertical activity rail. Selecting the active item again collapses its panel,
 * matching IDE behaviour.
 */
export function ActivityRail<T extends string>({
  items,
  active,
  onSelect,
  side = 'left',
  footer,
  ariaLabel,
}: Props<T>) {
  return (
    <nav className={`rail ${side === 'right' ? 'right' : ''}`} aria-label={ariaLabel}>
      {items.map((item) => (
        <Tooltip
          key={item.id}
          label={item.label}
          shortcut={item.shortcut}
          placement={side === 'right' ? 'top' : 'bottom'}
        >
          <button
            type="button"
            className={`rail-btn ${active === item.id ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
            aria-label={item.label}
            aria-pressed={active === item.id}
          >
            <item.icon size={18} strokeWidth={1.75} />
            {item.badge ? <span className="rail-badge" aria-hidden="true" /> : null}
          </button>
        </Tooltip>
      ))}
      <span className="rail-spacer" />
      {footer}
    </nav>
  )
}
