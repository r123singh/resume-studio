import { FilePlus2, FolderOpen, KeyRound } from 'lucide-react'

type Props = {
  onOpenFolder: () => void
  onSettings: () => void
}

const STEPS = [
  'Open or create a workspace folder — we scaffold base-resume.md, job-preferences.md, resumes/ and apply-kits/.',
  'Paste your master resume into base-resume.md and set your target keywords in preferences.',
  'Shortlist roles in Job hunt, or paste a job description into Tailor.',
  'Review every AI edit as a diff before it touches a file.',
  'Export a PDF or build a full apply kit when you are ready to submit.',
]

export function Welcome({ onOpenFolder, onSettings }: Props) {
  return (
    <main className="welcome">
      <div className="welcome-inner">
        <span className="welcome-mark" aria-hidden="true">
          <FilePlus2 size={20} strokeWidth={1.75} />
        </span>
        <p className="eyebrow">Bring your own API key</p>
        <h1>Resume Studio</h1>
        <p className="lede">
          A local-first workspace for your master resume and per-role tailored drafts. Research a
          role, generate evidence-backed edits, review every change as a diff, and export.
        </p>
        <div className="welcome-actions">
          <button type="button" className="btn primary" onClick={onOpenFolder}>
            <FolderOpen size={14} strokeWidth={1.75} />
            Open workspace folder
          </button>
          <button type="button" className="btn" onClick={onSettings}>
            <KeyRound size={14} strokeWidth={1.75} />
            Add API key
          </button>
        </div>
        <ol className="welcome-steps">
          {STEPS.map((step, i) => (
            <li key={step}>
              <span className="welcome-step-num">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </main>
  )
}
