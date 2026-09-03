import {
  Check,
  CircleDot,
  FileDown,
  FilePlus2,
  FolderOpen,
  GitBranch,
  Loader2,
  MessagesSquare,
  Save,
  Search,
  Settings,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { IconButton } from './ui/IconButton'
import { Tooltip } from './ui/Tooltip'

type Props = {
  title: string
  onOpenFolder: () => void
  onSave: () => void
  onExport: () => void
  onApplyKit: () => void
  onInterviewPrep: () => void
  onSettings: () => void
  onCommandPalette?: () => void
  onGit?: () => void
  onAchievement?: () => void
  onEvidence?: () => void
  canSave: boolean
  canExport: boolean
  canApplyKit: boolean
  canInterviewPrep: boolean
  busy?: boolean
  dirty?: boolean
  lastSavedAt?: number | null
  gitSummary?: string
}

function relativeTime(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

/** Save state reads as a quiet indicator, never a popup. */
function SaveState({
  busy,
  dirty,
  canSave,
  lastSavedAt,
}: {
  busy?: boolean
  dirty?: boolean
  canSave: boolean
  lastSavedAt?: number | null
}) {
  if (!canSave) return null
  if (busy) {
    return (
      <span className="save-state saving">
        <Loader2 size={12} className="spin" strokeWidth={2} />
        Saving…
      </span>
    )
  }
  if (dirty) {
    return (
      <span className="save-state dirty">
        <CircleDot size={11} strokeWidth={2} />
        Unsaved
      </span>
    )
  }
  return (
    <span className="save-state" title={lastSavedAt ? `Saved ${relativeTime(lastSavedAt)}` : 'Saved'}>
      <Check size={12} strokeWidth={2.5} />
      Saved
    </span>
  )
}

export function TopBar({
  title,
  onOpenFolder,
  onSave,
  onExport,
  onApplyKit,
  onInterviewPrep,
  onSettings,
  onCommandPalette,
  onGit,
  onAchievement,
  onEvidence,
  canSave,
  canExport,
  canApplyKit,
  canInterviewPrep,
  busy,
  dirty,
  lastSavedAt,
  gitSummary,
}: Props) {
  const fileName = title.split('/').pop() || title
  const directory = title.includes('/') ? title.slice(0, title.lastIndexOf('/')) : ''

  return (
    <header className="topbar">
      <div className="topbar-lead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <FilePlus2 size={14} strokeWidth={1.5} />
          </span>
          Resume Studio
        </div>
        <IconButton icon={FolderOpen} label="Open workspace folder" onClick={onOpenFolder} />
        <IconButton
          icon={Save}
          label="Save"
          shortcut="Ctrl+S"
          onClick={onSave}
          disabled={!canSave}
        />
        {canSave || title !== 'Resume Studio' ? (
          <div className="doc-identity" title={title}>
            {directory ? <span className="doc-path">{directory}/</span> : null}
            <span className="doc-name">{fileName}</span>
            <SaveState busy={busy} dirty={dirty} canSave={canSave} lastSavedAt={lastSavedAt} />
          </div>
        ) : null}
      </div>

      <div className="topbar-center">
        {onCommandPalette ? (
          <Tooltip label="Search commands and files" shortcut="Ctrl+K">
            <button type="button" className="btn ghost command-trigger" onClick={onCommandPalette}>
              <Search size={14} strokeWidth={1.5} />
              <span>Search</span>
              <kbd>Ctrl+K</kbd>
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div className="topbar-actions">
        {onEvidence ? (
          <IconButton
            icon={Sparkles}
            label="Tailor with Evidence"
            shortcut="Ctrl+Shift+E"
            onClick={onEvidence}
          />
        ) : null}
        {onAchievement ? (
          <IconButton
            icon={Trophy}
            label="Achievement builder"
            shortcut="Ctrl+Shift+A"
            onClick={onAchievement}
          />
        ) : null}
        {onGit ? (
          <IconButton
            icon={GitBranch}
            label={gitSummary ? `Git — ${gitSummary}` : 'Git status and commit'}
            shortcut="Ctrl+Shift+G"
            onClick={onGit}
          />
        ) : null}
        <IconButton
          icon={FileDown}
          label="Export PDF"
          onClick={onExport}
          disabled={!canExport}
        />
        <IconButton
          icon={MessagesSquare}
          label="Generate interview prep"
          onClick={onInterviewPrep}
          disabled={!canInterviewPrep}
        />

        <span className="topbar-divider" />

        <button
          type="button"
          className="btn"
          onClick={onApplyKit}
          disabled={!canApplyKit}
          title="Build resume PDF, cover letter, form snippets and checklist"
        >
          Apply kit
        </button>
        <IconButton icon={Settings} label="Settings" onClick={onSettings} />
      </div>
    </header>
  )
}
