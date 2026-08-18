import { useEffect, useMemo, useState } from 'react'
import {
  composeAchievement,
  parseAchievementBullet,
  tagAchievementParts,
  type AchievementParts,
} from '../lib/achievements'

type Props = {
  open: boolean
  seedText?: string
  onClose: () => void
  onInsert: (bullet: string) => void
}

const empty: AchievementParts = { action: '', metric: '', impact: '', tool: '' }

export function AchievementBuilder({ open, seedText = '', onClose, onInsert }: Props) {
  const [parts, setParts] = useState<AchievementParts>(empty)

  useEffect(() => {
    if (!open) return
    if (seedText.trim()) {
      const parsed = parseAchievementBullet(seedText)
      setParts({
        action: parsed.action,
        metric: parsed.metric,
        impact: parsed.impact,
        tool: parsed.tool,
      })
    } else {
      setParts(empty)
    }
  }, [open, seedText])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const preview = useMemo(() => composeAchievement(parts), [parts])
  const tags = useMemo(() => tagAchievementParts(preview), [preview])
  const suggestions = useMemo(
    () => parseAchievementBullet(preview).suggestions,
    [preview],
  )

  if (!open) return null

  const set =
    (key: keyof AchievementParts) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setParts((p) => ({ ...p, [key]: e.target.value }))

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal achievement-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Achievement block builder"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Achievement builder</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">Structure bullets as Action + Metric + Impact + Tool.</p>

        <label className="field">
          <span>Action verb / what you did</span>
          <input value={parts.action} onChange={set('action')} placeholder="Improved page load speed" />
        </label>
        <label className="field">
          <span>Metric</span>
          <input value={parts.metric} onChange={set('metric')} placeholder="42%" />
        </label>
        <label className="field">
          <span>Impact / business outcome</span>
          <input
            value={parts.impact}
            onChange={set('impact')}
            placeholder="cutting bounce rate on checkout"
          />
        </label>
        <label className="field">
          <span>Tool / stack</span>
          <input value={parts.tool} onChange={set('tool')} placeholder="React and Redis" />
        </label>

        <div className="achv-preview-block">
          <div className="lens-block-title">Preview</div>
          <p className="achv-preview">- {preview}</p>
          <div className="lens-chips">
            {tags.map((t, i) => (
              <span key={`${t.kind}-${i}`} className={`lens-chip achv-tag ${t.kind}`}>
                {t.kind}: {t.text}
              </span>
            ))}
          </div>
        </div>

        {suggestions.length ? (
          <ul className="lens-issues">
            {suggestions.map((s) => (
              <li key={s} className="lens-issue warn">
                {s}
              </li>
            ))}
          </ul>
        ) : (
          <p className="lens-muted">Looks strong — action, metric, and context are present.</p>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!parts.action.trim()}
            onClick={() => {
              onInsert(`- ${preview}`)
              onClose()
            }}
          >
            Insert bullet
          </button>
        </div>
      </div>
    </div>
  )
}
