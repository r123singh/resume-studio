import { useEffect, useMemo, useState } from 'react'
import { Eye } from 'lucide-react'
import { Segmented } from './ui/Segmented'
import {
  analyzeRecruiterLens,
  type LensMode,
  type RecruiterLensReport,
} from '../lib/recruiter-lens'

type Props = {
  content: string
  jobDescription?: string
  mode: LensMode
  onModeChange: (mode: LensMode) => void
}

export function RecruiterLens({ content, jobDescription = '', mode, onModeChange }: Props) {
  const [previewStep, setPreviewStep] = useState(-1)
  const [playing, setPlaying] = useState(false)

  const report = useMemo(
    () => analyzeRecruiterLens(content, jobDescription),
    [content, jobDescription],
  )

  useEffect(() => {
    if (!playing) return
    setPreviewStep(0)
    const timers = [0, 1, 2, 3].map((step) =>
      window.setTimeout(() => setPreviewStep(step), step * 1500),
    )
    const end = window.setTimeout(() => {
      setPlaying(false)
      setPreviewStep(-1)
    }, 6500)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.clearTimeout(end)
    }
  }, [playing])

  const startPreview = () => {
    onModeChange('scan')
    setPlaying(true)
  }

  return (
    <div className={`lens-shell mode-${mode} ${playing ? 'playing' : ''}`}>
      <div className="lens-toolbar">
        <Segmented
          ariaLabel="Editor view"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'edit', label: 'Edit', title: 'Markdown editor' },
            { value: 'ats', label: 'ATS', title: 'ATS parse preview and keyword match' },
            { value: 'scan', label: 'Scan', title: 'Recruiter attention heatmap' },
          ]}
        />
        <button
          type="button"
          className="btn sm lens-preview-btn"
          disabled={!content.trim() || playing}
          onClick={startPreview}
        >
          <Eye size={13} strokeWidth={1.75} />
          {playing ? 'Scanning…' : 'Preview as recruiter'}
        </button>
      </div>

      {playing ? (
        <SixSecondPreview report={report} step={previewStep} content={content} />
      ) : mode === 'ats' ? (
        <AtsPanel report={report} />
      ) : mode === 'scan' ? (
        <ScanPanel report={report} content={content} />
      ) : null}
    </div>
  )
}

function AtsPanel({ report }: { report: RecruiterLensReport }) {
  const rows: Array<{ label: string; ok: boolean; detail: string }> = [
    { label: 'Name', ok: report.ats.name, detail: report.ats.name ? 'Detected' : 'Missing' },
    { label: 'Email', ok: report.ats.email, detail: report.ats.email ? 'Detected' : 'Missing' },
    { label: 'Phone', ok: report.ats.phone, detail: report.ats.phone ? 'Detected' : 'Missing' },
    {
      label: 'LinkedIn',
      ok: report.ats.linkedin,
      detail: report.ats.linkedin ? 'Detected' : 'Not found',
    },
    {
      label: 'Experience',
      ok: report.ats.experienceRoles > 0,
      detail: `${report.ats.experienceRoles} role signal(s)`,
    },
    {
      label: 'Skills',
      ok: report.ats.skillsCount > 0,
      detail: `${report.ats.skillsCount} skill signal(s)`,
    },
    {
      label: 'Section order',
      ok: report.ats.sectionOrderOk,
      detail: report.ats.sectionOrderOk ? 'OK' : 'Non-standard',
    },
  ]

  return (
    <div className="lens-body">
      <div className="lens-score-row">
        <div className="lens-score">
          <span className="lens-score-label">Keyword match</span>
          <span className="lens-score-value">{report.keywords.score}%</span>
        </div>
        <div className="lens-score-meta">
          {report.keywords.totalFromJd
            ? `${report.keywords.matched.length}/${Math.min(20, report.keywords.totalFromJd)} JD terms`
            : 'Paste a JD in Tailor/Hunt for keyword scoring'}
        </div>
      </div>

      <div className="ats-grid">
        {rows.map((r) => (
          <div key={r.label} className={`ats-row ${r.ok ? 'ok' : 'bad'}`}>
            <span className="ats-label">{r.label}</span>
            <span className="ats-detail">{r.detail}</span>
          </div>
        ))}
      </div>

      {report.ats.sectionsFound.length ? (
        <p className="lens-muted">Sections: {report.ats.sectionsFound.join(' · ')}</p>
      ) : null}

      <IssuesList report={report} />

      {report.keywords.missing.length ? (
        <div className="lens-block">
          <div className="lens-block-title">Missing JD keywords</div>
          <div className="lens-chips">
            {report.keywords.missing.map((k) => (
              <span key={k} className="lens-chip missing">
                {k}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {report.keywords.matched.length ? (
        <div className="lens-block">
          <div className="lens-block-title">Matched</div>
          <div className="lens-chips">
            {report.keywords.matched.slice(0, 12).map((k) => (
              <span key={k} className="lens-chip ok">
                {k}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ScanPanel({ report, content }: { report: RecruiterLensReport; content: string }) {
  const lines = content.split(/\r?\n/)
  return (
    <div className="lens-body">
      <p className="lens-skim">{report.skimSummary}</p>
      <IssuesList report={report} />
      <div className="scan-preview" aria-label="Recruiter attention heatmap">
        {lines.map((line, idx) => {
          const heat = report.heatLines[idx]?.weight ?? 0.05
          const focus = heat >= 0.55
          return (
            <div
              key={idx}
              className={`scan-line ${focus ? 'focus' : 'dim'}`}
              style={{ opacity: focus ? 0.35 + heat * 0.65 : 0.12 + heat * 0.15 }}
              title={report.heatLines[idx]?.reasons.join(', ') || undefined}
            >
              {line || ' '}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SixSecondPreview({
  report,
  step,
  content,
}: {
  report: RecruiterLensReport
  step: number
  content: string
}) {
  const lines = content.split(/\r?\n/)
  const labels = ['First glance', 'Skim path', 'Stop points', 'Ignored zones']
  return (
    <div className="lens-body six-sec">
      <div className="six-sec-label">
        {step < 0 ? 'Starting…' : `${labels[step] || 'Done'} (${Math.min(step + 1, 4)}/4)`}
      </div>
      <div className="scan-preview six-anim">
        {lines.map((line, idx) => {
          const heat = report.heatLines[idx]?.weight ?? 0.05
          let cls = 'scan-line dim'
          if (step === 0 && heat >= 0.85) cls = 'scan-line focus pulse'
          else if (step === 1 && heat >= 0.55) cls = 'scan-line focus'
          else if (step === 2 && heat >= 0.7) cls = 'scan-line focus stop'
          else if (step === 3 && heat < 0.4) cls = 'scan-line ignored'
          else if (step >= 0 && heat >= 0.55) cls = 'scan-line soft'
          return (
            <div key={idx} className={cls}>
              {line || ' '}
            </div>
          )
        })}
      </div>
      <p className="lens-skim">{report.skimSummary}</p>
    </div>
  )
}

function IssuesList({ report }: { report: RecruiterLensReport }) {
  if (!report.hierarchy.length) {
    return <p className="lens-muted">No major hierarchy warnings.</p>
  }
  return (
    <ul className="lens-issues">
      {report.hierarchy.map((issue) => (
        <li key={issue.id} className={`lens-issue ${issue.severity}`}>
          {issue.message}
        </li>
      ))}
    </ul>
  )
}
