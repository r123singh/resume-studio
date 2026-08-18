import { useEffect, useMemo, useState } from 'react'
import type { TreeNode } from '../../electron/preload'
import { RoleSwitcher } from './RoleSwitcher'

export type ApplicationRow = {
  id: number
  date: string
  company: string
  role: string
  location: string
  source: string
  jobUrl: string
  status: 'ready-to-apply' | 'applied' | 'skipped' | 'closed'
  notes: string
}

type Filter = 'all' | 'ready-to-apply' | 'applied' | 'skipped' | 'closed'

type Props = {
  rows: ApplicationRow[]
  busy: boolean
  onRefresh: () => void
  onSetStatus: (
    id: number,
    status: ApplicationRow['status'],
    note?: string,
  ) => Promise<void>
  onOpenJob: (url: string) => void
  onOpenKit: (notes: string) => void
  onInterviewPrep?: (row: ApplicationRow) => void
}

export function TrackerPanel({
  rows,
  busy,
  onRefresh,
  onSetStatus,
  onOpenJob,
  onOpenKit,
  onInterviewPrep,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter((r) => r.status === filter)
  }, [rows, filter])

  const counts = useMemo(() => {
    const c = { all: rows.length, ready: 0, applied: 0, skipped: 0, closed: 0 }
    for (const r of rows) {
      if (r.status === 'ready-to-apply') c.ready++
      else if (r.status === 'applied') c.applied++
      else if (r.status === 'skipped') c.skipped++
      else if (r.status === 'closed') c.closed++
    }
    return c
  }, [rows])

  return (
    <div className="tracker-panel">
      <div className="tracker-toolbar">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          aria-label="Filter applications"
        >
          <option value="all">All ({counts.all})</option>
          <option value="ready-to-apply">Ready ({counts.ready})</option>
          <option value="applied">Applied ({counts.applied})</option>
          <option value="skipped">Skipped ({counts.skipped})</option>
          <option value="closed">Closed ({counts.closed})</option>
        </select>
        <button type="button" className="btn ghost" disabled={busy} onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <div className="tracker-list">
        {filtered.length === 0 ? (
          <div className="tracker-empty">
            No applications yet. Tailor a JD and build an Apply kit to log one.
          </div>
        ) : (
          filtered.map((row) => (
            <article key={row.id} className={`tracker-card status-${row.status}`}>
              <div className="tracker-card-top">
                <div>
                  <div className="tracker-company">{row.company || 'Unknown company'}</div>
                  <div className="tracker-role">{row.role || 'Untitled role'}</div>
                </div>
                <span className={`status-pill ${row.status}`}>{row.status}</span>
              </div>
              <div className="tracker-meta">
                <span>{row.date || '—'}</span>
                {row.location ? <span>{row.location}</span> : null}
              </div>
              <div className="tracker-actions">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!row.jobUrl}
                  onClick={() => onOpenJob(row.jobUrl)}
                >
                  Job URL
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!/kit:\s*apply-kits\//i.test(row.notes)}
                  onClick={() => onOpenKit(row.notes)}
                >
                  Open kit
                </button>
                {onInterviewPrep ? (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => onInterviewPrep(row)}
                  >
                    Interview prep
                  </button>
                ) : null}
                {row.status !== 'applied' ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void onSetStatus(row.id, 'applied', 'marked applied in tracker')}
                  >
                    Mark applied
                  </button>
                ) : null}
                {row.status === 'ready-to-apply' ? (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void onSetStatus(row.id, 'skipped', 'skipped in tracker')}
                  >
                    Skip
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

export type JobListing = {
  id: string
  title: string
  company: string
  location: string
  jobUrl: string
  source: 'RemoteOK' | 'Remotive'
  description: string
  tags: string[]
  score: number
  scoreReasons: string[]
  alreadyTracked: boolean
}

type HuntProps = {
  busy: boolean
  results: JobListing[]
  selectedIds: Set<string>
  query: string
  onQueryChange: (q: string) => void
  onSearch: () => void
  onToggle: (id: string) => void
  onSelectTop: (n: number) => void
  onClearSelection: () => void
  onOpenJob: (url: string) => void
  onPrepareSelected: () => void
  onOpenPreferences: () => void
}

function HuntPanel({
  busy,
  results,
  selectedIds,
  query,
  onQueryChange,
  onSearch,
  onToggle,
  onSelectTop,
  onClearSelection,
  onOpenJob,
  onPrepareSelected,
  onOpenPreferences,
}: HuntProps) {
  return (
    <div className="tracker-panel">
      <div className="chat-form" style={{ borderTop: 'none' }}>
        <input
          placeholder="Search keywords (e.g. senior product manager AI)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch()
          }}
        />
        <div className="row-2">
          <button type="button" className="btn primary block" disabled={busy} onClick={onSearch}>
            {busy ? 'Searching…' : 'Search free boards'}
          </button>
          <button type="button" className="btn ghost block" disabled={busy} onClick={onOpenPreferences}>
            Preferences
          </button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Sources: RemoteOK + Remotive. Ranked with your job-preferences.md. Approve then prepare.
        </p>
      </div>

      {results.length > 0 ? (
        <div className="tracker-toolbar">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => onSelectTop(5)}>
            Top 5
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClearSelection}>
            Clear
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || selectedIds.size === 0}
            onClick={onPrepareSelected}
          >
            Prepare {selectedIds.size || ''}
          </button>
        </div>
      ) : null}

      <div className="tracker-list">
        {results.length === 0 ? (
          <div className="tracker-empty">
            Run a search to shortlist remote roles. Selected jobs will tailor resumes + build apply
            kits.
          </div>
        ) : (
          results.map((job) => {
            const checked = selectedIds.has(job.id)
            return (
              <article
                key={job.id}
                className={`tracker-card ${checked ? 'hunt-selected' : ''} ${job.alreadyTracked ? 'hunt-tracked' : ''}`}
              >
                <div className="tracker-card-top">
                  <label className="hunt-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={job.alreadyTracked}
                      onChange={() => onToggle(job.id)}
                    />
                    <div>
                      <div className="tracker-company">{job.company}</div>
                      <div className="tracker-role">{job.title}</div>
                    </div>
                  </label>
                  <span className="status-pill ready-to-apply">{job.score}</span>
                </div>
                <div className="tracker-meta">
                  <span>{job.source}</span>
                  <span>{job.location || 'Remote'}</span>
                  {job.alreadyTracked ? <span>tracked</span> : null}
                </div>
                {job.scoreReasons.length ? (
                  <div className="hunt-reasons">{job.scoreReasons.join(' · ')}</div>
                ) : null}
                <div className="tracker-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={!job.jobUrl}
                    onClick={() => onOpenJob(job.jobUrl)}
                  >
                    Open listing
                  </button>
                </div>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}

/** Side panel with Hunt / Tailor / Edit / Tracker / Roles tabs. */
type AgentToolView = {
  name: string
  input: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  summary?: string
}

type ChatMessageView = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attribution?: string
  streaming?: boolean
  feedback?: 'up' | 'down'
  provider?: string
  model?: string
  tools?: AgentToolView[]
}

const TOOL_LABELS: Record<string, string> = {
  list_workspace_files: 'Listed workspace files',
  read_resume_file: 'Read',
  search_workspace: 'Searched for',
  research_job: 'Researched job',
  propose_edit: 'Proposed edit to',
}

function toolLine(t: AgentToolView): string {
  const label = TOOL_LABELS[t.name] || t.name
  const target =
    (t.input.relativePath as string) ||
    (t.input.query as string) ||
    (t.input.url as string) ||
    (t.input.subdirectory as string) ||
    ''
  return [label, target].filter(Boolean).join(' ')
}

type SideProps = {
  messages: ChatMessageView[]
  busy: boolean
  applications: ApplicationRow[]
  huntResults: JobListing[]
  huntQuery: string
  huntSelectedIds: Set<string>
  workspace: string | null
  tree: TreeNode[]
  jobDescription: string
  onHuntQueryChange: (q: string) => void
  onHuntSearch: () => void
  onHuntToggle: (id: string) => void
  onHuntSelectTop: (n: number) => void
  onHuntClearSelection: () => void
  onHuntPrepare: () => void
  onOpenPreferences: () => void
  onTailor: (input: {
    company: string
    role: string
    location: string
    jobUrl: string
    jobDescription: string
  }) => Promise<void>
  onEdit: (instruction: string) => Promise<void>
  onRefreshApps: () => void
  onSetStatus: (
    id: number,
    status: ApplicationRow['status'],
    note?: string,
  ) => Promise<void>
  onOpenJob: (url: string) => void
  onOpenKit: (notes: string) => void
  onInterviewPrepRow?: (row: ApplicationRow) => void
  onOpenAbsolute?: (absolutePath: string, relativePath: string) => void | Promise<void>
  onTreeRefresh?: () => void | Promise<void>
  onFeedback?: (id: string, rating: 'up' | 'down') => void
  evidenceSlot?: React.ReactNode
  focusTracker?: boolean
  focusHunt?: boolean
  focusRoles?: boolean
  focusEvidence?: boolean
  mode?: PanelMode
  onModeChange?: (mode: PanelMode) => void
}

export type PanelMode = 'hunt' | 'tailor' | 'edit' | 'tracker' | 'roles' | 'evidence'

const PANEL_TITLES: Record<PanelMode, string> = {
  evidence: 'Evidence',
  hunt: 'Job hunt',
  tailor: 'Tailor',
  edit: 'Assistant',
  tracker: 'Tracker',
  roles: 'Role variants',
}

const PANEL_HINTS: Record<PanelMode, string> = {
  evidence: 'Ctrl+Shift+E',
  hunt: '',
  tailor: '',
  edit: '',
  tracker: '',
  roles: '',
}

export function SidePanel({
  messages,
  busy,
  applications,
  huntResults,
  huntQuery,
  huntSelectedIds,
  workspace,
  tree,
  jobDescription,
  onHuntQueryChange,
  onHuntSearch,
  onHuntToggle,
  onHuntSelectTop,
  onHuntClearSelection,
  onHuntPrepare,
  onOpenPreferences,
  onTailor,
  onEdit,
  onRefreshApps,
  onSetStatus,
  onOpenJob,
  onOpenKit,
  onInterviewPrepRow,
  onOpenAbsolute,
  onTreeRefresh,
  onFeedback,
  evidenceSlot,
  focusTracker,
  focusHunt,
  focusRoles,
  focusEvidence,
  mode: controlledMode,
  onModeChange,
}: SideProps) {
  const [internalMode, setInternalMode] = useState<PanelMode>('hunt')
  // Controlled by App when the activity rail drives the panel.
  const mode = controlledMode ?? internalMode
  const setMode = onModeChange ?? setInternalMode
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [location, setLocation] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [jd, setJd] = useState('')
  const [instruction, setInstruction] = useState('')

  useEffect(() => {
    if (focusTracker) setMode('tracker')
  }, [focusTracker])

  useEffect(() => {
    if (focusHunt) setMode('hunt')
  }, [focusHunt])

  useEffect(() => {
    if (focusRoles) setMode('roles')
  }, [focusRoles])

  useEffect(() => {
    if (focusEvidence) setMode('evidence')
  }, [focusEvidence])

  useEffect(() => {
    if (mode === 'tracker') onRefreshApps()
  }, [mode, onRefreshApps])

  return (
    <aside className="chat-panel">
      <div className="pane-header">
        <span>{PANEL_TITLES[mode]}</span>
        <span className="pane-header-actions">
          <span className="pane-hint">{PANEL_HINTS[mode]}</span>
        </span>
      </div>

      {mode === 'evidence' ? (
        <div className="evidence-scroll">{evidenceSlot}</div>
      ) : mode === 'tracker' ? (
        <TrackerPanel
          rows={applications}
          busy={busy}
          onRefresh={onRefreshApps}
          onSetStatus={onSetStatus}
          onOpenJob={onOpenJob}
          onOpenKit={onOpenKit}
          onInterviewPrep={onInterviewPrepRow}
        />
      ) : mode === 'hunt' ? (
        <HuntPanel
          busy={busy}
          results={huntResults}
          selectedIds={huntSelectedIds}
          query={huntQuery}
          onQueryChange={onHuntQueryChange}
          onSearch={onHuntSearch}
          onToggle={onHuntToggle}
          onSelectTop={onHuntSelectTop}
          onClearSelection={onHuntClearSelection}
          onOpenJob={onOpenJob}
          onPrepareSelected={onHuntPrepare}
          onOpenPreferences={onOpenPreferences}
        />
      ) : mode === 'roles' && workspace && onOpenAbsolute && onTreeRefresh ? (
        <RoleSwitcher
          workspace={workspace}
          tree={tree}
          jobDescription={jobDescription}
          busy={busy}
          onOpenPath={onOpenAbsolute}
          onTreeRefresh={onTreeRefresh}
        />
      ) : (
        <>
          <div className="chat-log" aria-live="polite">
            {messages.map((m) => (
              <div key={m.id} className={`chat-bubble ${m.role} ${m.streaming ? 'streaming' : ''}`}>
                {m.tools?.length ? (
                  <ul className="agent-trail">
                    {m.tools.map((t, i) => (
                      <li key={`${t.name}-${i}`} className={`agent-step ${t.status}`}>
                        <span className="agent-step-icon" aria-hidden="true">
                          {t.status === 'running' ? '◌' : t.status === 'ok' ? '✓' : '✕'}
                        </span>
                        <span className="agent-step-text">{toolLine(t)}</span>
                        {t.summary ? <span className="agent-step-summary">{t.summary}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="chat-bubble-body">{m.content}</div>
                {m.attribution ? <div className="chat-meta">{m.attribution}</div> : null}
                {m.role === 'assistant' && onFeedback && !m.streaming ? (
                  <div className="chat-feedback">
                    <button
                      type="button"
                      className={`btn ghost feedback-btn ${m.feedback === 'up' ? 'active' : ''}`}
                      aria-label="Helpful"
                      onClick={() => onFeedback(m.id, 'up')}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className={`btn ghost feedback-btn ${m.feedback === 'down' ? 'active' : ''}`}
                      aria-label="Not helpful"
                      onClick={() => onFeedback(m.id, 'down')}
                    >
                      ▼
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {mode === 'tailor' ? (
            <div className="chat-form">
              <div className="row-2">
                <input
                  placeholder="Company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
                <input placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} />
              </div>
              <div className="row-2">
                <input
                  placeholder="Location (optional)"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
                <input
                  placeholder="Job URL (optional)"
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                />
              </div>
              <textarea
                placeholder="Paste the full job description…"
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                rows={8}
              />
              <button
                type="button"
                className="btn primary block"
                disabled={busy}
                onClick={() =>
                  void onTailor({
                    company,
                    role,
                    location,
                    jobUrl,
                    jobDescription: jd,
                  })
                }
              >
                {busy ? 'Tailoring…' : 'Generate tailored resume'}
              </button>
            </div>
          ) : (
            <div className="chat-form">
              <textarea
                placeholder="Ask for a rewrite, or select text in the editor for Improve / Shorten / Add metrics."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && instruction.trim() && !busy) {
                    e.preventDefault()
                    const text = instruction
                    setInstruction('')
                    void onEdit(text)
                  }
                }}
              />
              <div className="chat-form-actions">
                <span className="muted small">Ctrl+Enter to send</span>
                <button
                  type="button"
                  className={`btn ${instruction.trim() ? 'primary' : ''} sm`}
                  disabled={busy || !instruction.trim()}
                  onClick={() => {
                    const text = instruction
                    setInstruction('')
                    void onEdit(text)
                  }}
                >
                  {busy ? 'Working…' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  )
}

