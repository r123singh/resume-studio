import { useEffect, useMemo, useState } from 'react'

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

/** Side panel with Hunt / Tailor / Edit / Tracker tabs. */
type SideProps = {
  messages: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string }>
  busy: boolean
  applications: ApplicationRow[]
  huntResults: JobListing[]
  huntQuery: string
  huntSelectedIds: Set<string>
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
  focusTracker?: boolean
  focusHunt?: boolean
}

export function SidePanel({
  messages,
  busy,
  applications,
  huntResults,
  huntQuery,
  huntSelectedIds,
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
  focusTracker,
  focusHunt,
}: SideProps) {
  const [mode, setMode] = useState<'hunt' | 'tailor' | 'edit' | 'tracker'>('hunt')
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
    if (mode === 'tracker') onRefreshApps()
  }, [mode, onRefreshApps])

  return (
    <aside className="chat-panel">
      <div className="pane-header">Workspace</div>
      <div className="mode-tabs mode-tabs-4">
        <button
          type="button"
          className={mode === 'hunt' ? 'tab active' : 'tab'}
          onClick={() => setMode('hunt')}
        >
          Hunt
        </button>
        <button
          type="button"
          className={mode === 'tailor' ? 'tab active' : 'tab'}
          onClick={() => setMode('tailor')}
        >
          Tailor
        </button>
        <button
          type="button"
          className={mode === 'edit' ? 'tab active' : 'tab'}
          onClick={() => setMode('edit')}
        >
          Edit
        </button>
        <button
          type="button"
          className={mode === 'tracker' ? 'tab active' : 'tab'}
          onClick={() => setMode('tracker')}
        >
          Tracker
        </button>
      </div>

      {mode === 'tracker' ? (
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
      ) : (
        <>
          <div className="chat-log">
            {messages.map((m) => (
              <div key={m.id} className={`chat-bubble ${m.role}`}>
                {m.content}
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
                placeholder="e.g. Shorten the summary and emphasize AI governance…"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={5}
              />
              <button
                type="button"
                className="btn primary block"
                disabled={busy}
                onClick={() => {
                  const text = instruction
                  setInstruction('')
                  void onEdit(text)
                }}
              >
                {busy ? 'Editing…' : 'Apply AI edit'}
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  )
}

