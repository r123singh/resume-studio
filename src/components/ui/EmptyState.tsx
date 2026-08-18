import type { ComponentType, ReactNode } from 'react'

type Props = {
  icon?: ComponentType<{ size?: number | string; strokeWidth?: number | string }>
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, compact }: Props) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`.trim()}>
      {Icon ? (
        <span className="empty-state-icon" aria-hidden="true">
          <Icon size={compact ? 18 : 22} strokeWidth={1.5} />
        </span>
      ) : null}
      <p className="empty-state-title">{title}</p>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}
