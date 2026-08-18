import { useCallback, useEffect, useState } from 'react'

type GitStatus = Awaited<ReturnType<Window['resumeStudio']['gitStatus']>>
type GitDiff = Awaited<ReturnType<Window['resumeStudio']['gitDiff']>>

type Props = {
  open: boolean
  workspace: string
  onClose: () => void
  onStatus?: (summary: string) => void
}

export function GitPanel({ open, workspace, onClose, onStatus }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [message, setMessage] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const [s, d] = await Promise.all([
        window.resumeStudio.gitStatus(workspace),
        window.resumeStudio.gitDiff(workspace),
      ])
      setStatus(s)
      setDiff(d)
      onStatus?.(s.isRepo ? `${s.branch || 'git'}: ${s.summary}` : 'No git repo')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [workspace, onStatus])

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const initRepo = async () => {
    setBusy(true)
    setError('')
    try {
      await window.resumeStudio.gitInit(workspace)
      setMessage('Initialized git repository.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await window.resumeStudio.gitCommit(workspace, commitMsg)
      setMessage(`Committed ${result.commit}`)
      setCommitMsg('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const fileList = status
    ? [
        ...status.staged.map((f) => ({ f, kind: 'staged' as const })),
        ...status.modified.map((f) => ({ f, kind: 'modified' as const })),
        ...status.not_added.map((f) => ({ f, kind: 'untracked' as const })),
        ...status.deleted.map((f) => ({ f, kind: 'deleted' as const })),
      ]
    : []

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal git-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Git"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Git</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {!status?.isRepo ? (
          <>
            <p className="muted">This workspace is not a git repository.</p>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void initRepo()}>
              git init
            </button>
          </>
        ) : (
          <>
            <div className="git-status-line">
              <strong>{status.branch}</strong>
              <span className="muted">{status.summary}</span>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void refresh()}>
                Refresh
              </button>
            </div>

            <div className="git-files">
              {fileList.length === 0 ? (
                <p className="muted">Working tree clean.</p>
              ) : (
                <ul>
                  {fileList.map(({ f, kind }) => (
                    <li key={`${kind}:${f}`}>
                      <span className={`git-kind ${kind}`}>{kind}</span> {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="lens-block-title">Diff preview</div>
            <pre className="git-diff">
              {[diff?.staged ? `STAGED\n${diff.staged}` : '', diff?.unstaged ? `UNSTAGED\n${diff.unstaged}` : '']
                .filter(Boolean)
                .join('\n\n') || 'No diff'}
            </pre>

            <label className="field">
              <span>Commit message</span>
              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder="Describe why this change matters"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy || !commitMsg.trim()}
                onClick={() => void commit()}
              >
                Stage all & commit
              </button>
            </div>
          </>
        )}

        {message ? <p className="settings-msg">{message}</p> : null}
        {error ? <p className="lens-issue error">{error}</p> : null}
      </div>
    </div>
  )
}
