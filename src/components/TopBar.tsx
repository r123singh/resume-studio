type Props = {
  title: string
  onOpenFolder: () => void
  onSave: () => void
  onExport: () => void
  onSettings: () => void
  canSave: boolean
  canExport: boolean
  status?: string
  busy?: boolean
}

export function TopBar({
  title,
  onOpenFolder,
  onSave,
  onExport,
  onSettings,
  canSave,
  canExport,
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
        <button type="button" className="btn primary" onClick={onExport} disabled={!canExport}>
          Export PDF
        </button>
        <button type="button" className="btn ghost" onClick={onSettings}>
          Settings
        </button>
      </div>
    </header>
  )
}
