import { useEffect, useMemo, useRef, useState } from 'react'
import { changedLineCount, lineDiff } from '../lib/ai/diff'

export type DiffEvidence = {
  id: string
  sourceUrl: string
  sourceTitle: string
  excerpt: string
}

type Props = {
  open: boolean
  title: string
  before: string
  after: string
  note?: string
  attribution?: string
  streaming?: boolean
  streamPreview?: string
  evidence?: DiffEvidence[]
  commitSuggestion?: string
  canCommit?: boolean
  onOpenSource?: (url: string) => void
  onAccept: (opts?: { commit: boolean; message: string }) => void
  onReject: () => void
}

export function DiffPreviewModal({
  open,
  title,
  before,
  after,
  note,
  attribution,
  streaming,
  streamPreview,
  evidence = [],
  commitSuggestion = '',
  canCommit = false,
  onOpenSource,
  onAccept,
  onReject,
}: Props) {
  const acceptRef = useRef<HTMLButtonElement>(null)
  const [commit, setCommit] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setCommitMessage(commitSuggestion)
    setCommit(false)
  }, [open, commitSuggestion])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => acceptRef.current?.focus(), 40)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onReject()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onReject])

  const diff = useMemo(() => lineDiff(before, after || streamPreview || ''), [before, after, streamPreview])
  const counts = useMemo(() => changedLineCount(diff), [diff])

  if (!open) return null

  const previewBody = after || streamPreview || ''

  return (
    <div className="modal-backdrop" onClick={onReject} role="presentation">
      <div
        className="modal diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label="AI edit preview"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn ghost" onClick={onReject}>
            Cancel
          </button>
        </div>
        {attribution ? <p className="muted ai-attribution">{attribution}</p> : null}
        {note ? <p className="muted">{note}</p> : null}
        <div className="diff-stats">
          {streaming ? (
            <span className="pill busy">Streaming…</span>
          ) : (
            <>
              <span className="diff-add-stat">+{counts.added}</span>
              <span className="diff-del-stat">−{counts.removed}</span>
              <span className="muted">{previewBody.length} chars proposed</span>
            </>
          )}
        </div>

        <div className="diff-panels">
          <div className="diff-pane">
            <div className="lens-block-title">Current</div>
            <pre className="diff-pre">{before || '(empty)'}</pre>
          </div>
          <div className="diff-pane">
            <div className="lens-block-title">Proposed</div>
            <pre className="diff-pre diff-unified">
              {diff.slice(0, 400).map((line, idx) => (
                <div key={idx} className={`diff-line ${line.type}`}>
                  {line.type === 'add' ? '+ ' : line.type === 'remove' ? '− ' : '  '}
                  {line.text || ' '}
                </div>
              ))}
              {diff.length > 400 ? (
                <div className="diff-line same">… ({diff.length - 400} more lines)</div>
              ) : null}
            </pre>
          </div>
        </div>

        {evidence.length ? (
          <div className="diff-evidence">
            <div className="lens-block-title">Evidence backing this change</div>
            <ul className="diff-evidence-list">
              {evidence.map((e) => (
                <li key={`${e.id}-${e.sourceUrl}`}>
                  <button
                    type="button"
                    className="evidence-badge"
                    onClick={() => onOpenSource?.(e.sourceUrl)}
                    title={e.sourceUrl}
                  >
                    {e.id} · {e.sourceTitle.slice(0, 32)}
                  </button>
                  <span className="diff-evidence-excerpt">{e.excerpt.slice(0, 180)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {canCommit ? (
          <div className="diff-commit">
            <label className="check-row">
              <input
                type="checkbox"
                checked={commit}
                onChange={(e) => setCommit(e.target.checked)}
              />
              <span>Commit after applying</span>
            </label>
            {commit ? (
              <input
                className="diff-commit-msg"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message"
                aria-label="Commit message"
              />
            ) : null}
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onReject} disabled={streaming}>
            Reject
          </button>
          <button
            ref={acceptRef}
            type="button"
            className="btn primary"
            onClick={() => onAccept({ commit, message: commitMessage })}
            disabled={streaming || !previewBody.trim()}
          >
            {commit ? 'Apply & commit' : 'Accept edit'}
          </button>
        </div>
      </div>
    </div>
  )
}
