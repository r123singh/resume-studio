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
          generate a fit-focused draft with free NVIDIA NIM or Cursor SDK, refine in chat, export
          PDF.
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
          <li>Open or create a folder (we add <code>base-resume.md</code>, <code>job-preferences.md</code>, <code>resumes/</code>, <code>apply-kits/</code>).</li>
          <li>Paste your master resume into <code>base-resume.md</code>; tweak Hunt keywords in preferences.</li>
          <li>Use <strong>Hunt</strong> to shortlist remote roles, then <strong>Prepare</strong>.</li>
          <li>Or paste a JD in <strong>Tailor</strong> / click <strong>Apply kit</strong>.</li>
          <li>Track status in <strong>Tracker</strong>; use <strong>Interview prep</strong> when you get a call.</li>
          <li>Apply manually in the ATS.</li>
        </ol>
      </div>
    </main>
  )
}
