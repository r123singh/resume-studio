import type { ComponentType } from 'react'
import { Tooltip } from './Tooltip'

type Props = {
  icon: ComponentType<{ size?: number | string; strokeWidth?: number | string }>
  label: string
  shortcut?: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  size?: number
  placement?: 'top' | 'bottom'
  className?: string
}

/** Icon-only control. The label is always exposed as a tooltip and aria-label. */
export function IconButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
  active,
  size = 16,
  placement = 'bottom',
  className = '',
}: Props) {
  return (
    <Tooltip label={label} shortcut={shortcut} placement={placement}>
      <button
        type="button"
        className={`icon-btn ${active ? 'active' : ''} ${className}`.trim()}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
      >
        <Icon size={size} strokeWidth={1.75} />
      </button>
    </Tooltip>
  )
}
