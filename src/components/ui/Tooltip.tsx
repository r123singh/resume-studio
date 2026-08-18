import { useId, useState, type ReactNode } from 'react'

type Props = {
  label: string
  shortcut?: string
  placement?: 'top' | 'bottom'
  children: ReactNode
}

/**
 * Hover/focus tooltip. Renders the label into an aria-describedby node so it is
 * announced by screen readers, not just shown visually.
 */
export function Tooltip({ label, shortcut, placement = 'bottom', children }: Props) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span
      className="tooltip-host"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={id}>{children}</span>
      {open ? (
        <span className={`tooltip-bubble ${placement}`} role="tooltip" id={id}>
          {label}
          {shortcut ? <kbd>{shortcut}</kbd> : null}
        </span>
      ) : null}
    </span>
  )
}
