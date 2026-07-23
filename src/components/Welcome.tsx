type Props = {
  onOpenFolder: () => void
  onSettings: () => void
}

export function Welcome({ onOpenFolder, onSettings }: Props) {
  return (
    <main className="welcome">
      <div className="welcome-inner">
        <p className="eyebrow">Free · Bring your own API key</p>
        <h1>Resume Studio</h1>
        <p className="lede">
          A Cursor-like editor for your master resume and per-role tailored markdown — paste a JD,
          generate a fit-focused draft, refine in chat, export PDF.
        </p>
        <div className="welcome-actions">
          <button type="button" className="btn primary large" onClick={onOpenFolder}>
            Open workspace folder
          </button>
          <button type="button" className="btn ghost large" onClick={onSettings}>
            Add API key
          </button>
        </div>
        <ol className="welcome-steps">
          <li>Open or create a folder (we add <code>base-resume.md</code> + <code>resumes/</code>).</li>
          <li>Paste your master resume into <code>base-resume.md</code>.</li>
          <li>Use <strong>Tailor from JD</strong> to write <code>resumes/company--role.md</code>.</li>
          <li>Chat-edit, then <strong>Export PDF</strong> for the ATS upload.</li>
        </ol>
      </div>
    </main>
  )
}
