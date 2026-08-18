import { Bot, Check, CircleDot, GitBranch, Loader2, Moon, Sun, Zap } from 'lucide-react'
import type { ThemePreference } from '../lib/theme'

type Props = {
  status: string
  busy: boolean
  dirty: boolean
  hasFile: boolean
  gitSummary?: string
  provider: string
  model: string
  agentMode: boolean
  lensScore?: number | null
  cursorLine?: number
  cursorColumn?: number
  wordCount?: number
  theme: ThemePreference
  onToggleTheme: () => void
  onOpenGit?: () => void
  onOpenSettings: () => void
}

export function StatusBar({
  status,
  busy,
  dirty,
  hasFile,
  gitSummary,
  provider,
  model,
  agentMode,
  lensScore,
  cursorLine,
  cursorColumn,
  wordCount,
  theme,
  onToggleTheme,
  onOpenGit,
  onOpenSettings,
}: Props) {
  const scoreTone = lensScore == null ? '' : lensScore >= 75 ? 'ok' : lensScore >= 50 ? 'warn' : 'err'

  return (
    <footer className="statusbar" role="status" aria-live="polite">
      {gitSummary && onOpenGit ? (
        <button type="button" className="status-item" onClick={onOpenGit} title="Git status">
          <GitBranch size={12} strokeWidth={1.75} />
          {gitSummary}
        </button>
      ) : null}

      {hasFile ? (
        <span className={`status-item ${dirty ? 'warn' : ''}`}>
          {busy ? (
            <Loader2 size={12} strokeWidth={2} className="spin" />
          ) : dirty ? (
            <CircleDot size={11} strokeWidth={2} />
          ) : (
            <Check size={12} strokeWidth={2.5} />
          )}
          {busy ? 'Working' : dirty ? 'Unsaved changes' : 'Saved'}
        </span>
      ) : null}

      {status ? <span className="status-item status-message">{status}</span> : null}

      <span className="statusbar-spacer" />

      {lensScore != null ? (
        <span className={`status-item ${scoreTone}`} title="Recruiter Lens match score">
          <Zap size={12} strokeWidth={1.75} />
          Lens {lensScore}
        </span>
      ) : null}

      {typeof cursorLine === 'number' ? (
        <span className="status-item" title="Cursor position">
          Ln {cursorLine}, Col {cursorColumn ?? 1}
        </span>
      ) : null}

      {typeof wordCount === 'number' && wordCount > 0 ? (
        <span className="status-item" title="Word count">
          {wordCount} words
        </span>
      ) : null}

      <button
        type="button"
        className="status-item"
        onClick={onOpenSettings}
        title="Model provider — click to change"
      >
        {agentMode ? <Bot size={12} strokeWidth={1.75} /> : null}
        {provider}
        {model ? ` · ${model}` : ''}
      </button>

      <button
        type="button"
        className="status-item"
        onClick={onToggleTheme}
        title={`Theme: ${theme} — click to cycle`}
      >
        {theme === 'light' ? <Sun size={12} strokeWidth={1.75} /> : <Moon size={12} strokeWidth={1.75} />}
        {theme}
      </button>
    </footer>
  )
}
