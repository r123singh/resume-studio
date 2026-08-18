import { useMemo, useState } from 'react'
import type { EvidenceSnippet, JobContext } from '../../electron/preload'
import { evidenceCitationsFor, type EvidenceSuggestion } from '../lib/ai/evidence'

type Props = {
  url: string
  pastedText: string
  instruction: string
  busy: boolean
  researching: boolean
  context: JobContext | null
  suggestions: EvidenceSuggestion[]
  atsFit: number
  note: string
  pinnedIds: string[]
  error: string
  allowWebResearch: boolean
  onUrlChange: (url: string) => void
  onPastedTextChange: (text: string) => void
  onInstructionChange: (text: string) => void
  onResearch: (refresh: boolean) => void
  onTailor: () => void
  onToggleSuggestion: (id: string) => void
  onTogglePin: (snippetId: string) => void
  onOpenSource: (url: string) => void
  onPreview: () => void
  onEnableResearch: () => void
  onRefineSuggestion: (id: string) => void
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 32)
  }
}

export function EvidencePanel({
  url,
  pastedText,
  instruction,
  busy,
  researching,
  context,
  suggestions,
  atsFit,
  note,
  pinnedIds,
  error,
  allowWebResearch,
  onUrlChange,
  onPastedTextChange,
  onInstructionChange,
  onResearch,
  onTailor,
  onToggleSuggestion,
  onTogglePin,
  onOpenSource,
  onPreview,
  onEnableResearch,
  onRefineSuggestion,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showPaste, setShowPaste] = useState(false)

  const canResearch = Boolean(url.trim() || pastedText.trim())

  const acceptedCount = useMemo(
    () => suggestions.filter((s) => s.accepted).length,
    [suggestions],
  )

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="evidence-panel">
      <div className="evidence-form">
        <input
          placeholder="Job posting URL (https://…)"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          aria-label="Job posting URL"
        />
        <textarea
          placeholder="Optional focus, e.g. emphasize platform + AI governance"
          value={instruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          rows={2}
        />
        <button
          type="button"
          className="evidence-paste-toggle"
          onClick={() => setShowPaste((v) => !v)}
        >
          {showPaste ? 'Hide pasted job text' : 'Paste job text instead (for sites that block bots)'}
        </button>
        {showPaste ? (
          <textarea
            placeholder="Paste the full job description here. Used as-is, no network request."
            value={pastedText}
            onChange={(e) => onPastedTextChange(e.target.value)}
            rows={6}
          />
        ) : null}
        <div className="evidence-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={busy || researching || !url.trim()}
            onClick={() => onResearch(true)}
            title="Re-fetch, ignoring cache"
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || researching || !canResearch}
            onClick={() => onResearch(false)}
          >
            {researching ? 'Researching…' : url.trim() ? 'Research job' : 'Use pasted text'}
          </button>
        </div>
      </div>

      {!allowWebResearch ? (
        <div className="evidence-optin">
          <p className="muted">
            Web research is off. Resume Studio will fetch the job posting and a few company pages
            only after you opt in.
          </p>
          <button type="button" className="btn ghost block" onClick={onEnableResearch}>
            Enable job/company research
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="lens-issue error">
          <p>{error}</p>
          {!showPaste ? (
            <button
              type="button"
              className="evidence-paste-toggle"
              onClick={() => setShowPaste(true)}
            >
              Paste the job text instead
            </button>
          ) : null}
        </div>
      ) : null}

      {context ? (
        <>
          <div className="evidence-context">
            <div className="evidence-context-title">{context.title || context.url}</div>
            <div className="lens-score-meta">
              {context.company || 'pasted text'} · {context.snippets.length} snippets ·{' '}
              {context.cached ? 'cached' : 'fresh'}
            </div>
            <div className="evidence-pages">
              {context.fetchedPages.map((p) => (
                <span
                  key={p.url}
                  className={`evidence-page ${p.ok ? 'ok' : 'bad'}`}
                  title={p.error || p.url}
                >
                  {hostnameOf(p.url)}
                </span>
              ))}
            </div>
          </div>

          <div className="lens-block-title">Evidence ({context.snippets.length})</div>
          <ul className="evidence-list">
            {context.snippets.map((s) => (
              <EvidenceItem
                key={s.id}
                snippet={s}
                pinned={pinnedIds.includes(s.id)}
                expanded={expanded.has(s.id)}
                onToggleExpand={() => toggleExpand(s.id)}
                onTogglePin={() => onTogglePin(s.id)}
                onOpenSource={() => onOpenSource(s.sourceUrl)}
              />
            ))}
          </ul>

          <button
            type="button"
            className="btn primary block evidence-tailor-btn"
            disabled={busy || researching}
            onClick={onTailor}
          >
            {busy ? 'Tailoring…' : 'Tailor with Evidence'}
          </button>
        </>
      ) : null}

      {suggestions.length ? (
        <div className="evidence-suggestions">
          <div className="lens-score-row">
            <div>
              <span className="lens-score-label">ATS fit</span>
              <span className="lens-score-value">{atsFit}%</span>
            </div>
            <div className="lens-score-meta">
              {acceptedCount}/{suggestions.length} selected
            </div>
          </div>
          {note ? <p className="lens-skim">{note}</p> : null}

          <ul className="suggestion-list">
            {suggestions.map((s) => {
              const cites = context ? evidenceCitationsFor(s, context.snippets) : []
              return (
                <li key={s.id} className={`suggestion-card ${s.accepted ? 'accepted' : ''}`}>
                  <label className="suggestion-head">
                    <input
                      type="checkbox"
                      checked={s.accepted}
                      onChange={() => onToggleSuggestion(s.id)}
                    />
                    <span className="suggestion-text">{s.text}</span>
                  </label>
                  <div className="suggestion-meta">
                    <span className="suggestion-section">{s.section}</span>
                    <span className="muted">{s.target ? 'replaces a bullet' : 'new bullet'}</span>
                  </div>
                  <div className="evidence-badges">
                    {cites.length ? (
                      cites.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="evidence-badge"
                          title={c.text.slice(0, 240)}
                          onClick={() => onOpenSource(c.sourceUrl)}
                        >
                          {c.id} · {c.sourceTitle.slice(0, 28)}
                        </button>
                      ))
                    ) : (
                      <span className="evidence-badge unbacked">no evidence cited</span>
                    )}
                    <button
                      type="button"
                      className="btn ghost suggestion-edit"
                      onClick={() => onRefineSuggestion(s.id)}
                    >
                      Edit
                    </button>
                  </div>
                  {s.rationale ? <p className="suggestion-rationale">{s.rationale}</p> : null}
                </li>
              )
            })}
          </ul>

          <button
            type="button"
            className="btn primary block"
            disabled={busy || acceptedCount === 0}
            onClick={onPreview}
          >
            Preview diff ({acceptedCount})
          </button>
        </div>
      ) : null}
    </div>
  )
}

function EvidenceItem({
  snippet,
  pinned,
  expanded,
  onToggleExpand,
  onTogglePin,
  onOpenSource,
}: {
  snippet: EvidenceSnippet
  pinned: boolean
  expanded: boolean
  onToggleExpand: () => void
  onTogglePin: () => void
  onOpenSource: () => void
}) {
  return (
    <li className={`evidence-item kind-${snippet.kind} ${pinned ? 'pinned' : ''}`}>
      <div className="evidence-item-head">
        <span className="evidence-id">{snippet.id}</span>
        <span className="evidence-score">{snippet.score}</span>
        <button type="button" className="evidence-source" onClick={onOpenSource}>
          {snippet.sourceTitle.slice(0, 40) || snippet.sourceUrl}
        </button>
        <button
          type="button"
          className={`btn ghost evidence-pin ${pinned ? 'active' : ''}`}
          onClick={onTogglePin}
          title={pinned ? 'Unpin from prompt' : 'Pin to prompt'}
        >
          {pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>
      <button type="button" className="evidence-excerpt" onClick={onToggleExpand}>
        {expanded ? snippet.text : `${snippet.text.slice(0, 160)}${snippet.text.length > 160 ? '…' : ''}`}
      </button>
    </li>
  )
}
