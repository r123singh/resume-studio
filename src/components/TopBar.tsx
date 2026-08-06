type Props = {
  title: string
  onOpenFolder: () => void
  onSave: () => void
  onExport: () => void
  onApplyKit: () => void
  onInterviewPrep: () => void
  onSettings: () => void
  canSave: boolean
  canExport: boolean
  canApplyKit: boolean
  canInterviewPrep: boolean
  status?: string
  busy?: boolean
}

export function TopBar({
  title,
  onOpenFolder,
  onSave,
  onExport,
  onApplyKit,
  onInterviewPrep,
  onSettings,
  canSave,
  canExport,
  canApplyKit,
  canInterviewPrep,
  status,
  busy,
}: Props) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand">Resume Studio</div>
        <div className="file-title" title={title}>
          {title}
        </div>
      </div>
      <div className="topbar-actions">
        {busy ? <span className="pill busy">Working…</span> : null}
        {status ? <span className="status-text">{status}</span> : null}
        <button type="button" className="btn ghost" onClick={onOpenFolder}>
          Open folder
        </button>
        <button type="button" className="btn ghost" onClick={onSave} disabled={!canSave}>
          Save
        </button>
        <button type="button" className="btn ghost" onClick={onExport} disabled={!canExport}>
          Export PDF
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onApplyKit}
          disabled={!canApplyKit}
          title="Build resume PDF + cover letter + snippets + checklist"
        >
          Apply kit
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={onInterviewPrep}
          disabled={!canInterviewPrep}
          title="Generate interview prep from open resume + JD context"
        >
          Interview prep
        </button>
        <button type="button" className="btn ghost" onClick={onSettings}>
          Settings
        </button>
      </div>
    </header>
  )
}
