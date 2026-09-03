import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'
import { FileText, Sparkles, X } from 'lucide-react'
import { EmptyState } from './ui/EmptyState'
import { RecruiterLens } from './RecruiterLens'
import { analyzeRecruiterLens, type LensMode } from '../lib/recruiter-lens'
import { achievementSnippetTemplate } from '../lib/achievements'

export type EditorTab = {
  path: string
  relativePath: string
  dirty: boolean
}

type Props = {
  content: string
  relativePath: string | null
  tabs?: EditorTab[]
  activePath?: string | null
  onSelectTab?: (path: string) => void
  onCloseTab?: (path: string) => void
  jobDescription?: string
  lensMode: LensMode
  ghostText?: string
  ghostLabel?: string
  ghostStreaming?: boolean
  theme?: 'light' | 'dark'
  aiBusy?: boolean
  onLensModeChange: (mode: LensMode) => void
  onChange: (value: string) => void
  onSelectionChange: (text: string) => void
  onMount: (editor: MonacoEditor.IStandaloneCodeEditor) => void
  onGhostAccept?: () => void
  onGhostDismiss?: () => void
  onAiAction?: (instruction: string) => void
}

/** Contextual rewrite actions, surfaced next to the selection instead of a global "AI" button. */
const AI_ACTIONS: { label: string; instruction: string }[] = [
  { label: 'Improve', instruction: 'Improve the clarity and impact of the selected text.' },
  { label: 'Shorten', instruction: 'Make the selected text more concise without losing meaning.' },
  {
    label: 'Add metrics',
    instruction:
      'Rewrite the selected text to foreground measurable outcomes. Use placeholders like [X%] where a number is unknown — never invent figures.',
  },
  {
    label: 'ATS keywords',
    instruction:
      'Rewrite the selected text to align with the target job description keywords while staying truthful.',
  },
]

const MARKER_OWNER = 'recruiter-lens'

function severityOf(s: 'error' | 'warn' | 'info'): monaco.MarkerSeverity {
  if (s === 'error') return monaco.MarkerSeverity.Error
  if (s === 'warn') return monaco.MarkerSeverity.Warning
  return monaco.MarkerSeverity.Info
}

export function EditorPane({
  content,
  relativePath,
  tabs = [],
  activePath = null,
  onSelectTab,
  onCloseTab,
  jobDescription = '',
  lensMode,
  ghostText = '',
  ghostLabel = 'AI suggestion',
  ghostStreaming = false,
  theme = 'dark',
  aiBusy = false,
  onLensModeChange,
  onChange,
  onSelectionChange,
  onMount,
  onGhostAccept,
  onGhostDismiss,
  onAiAction,
}: Props) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionBar, setActionBar] = useState<{ top: number; left: number } | null>(null)
  const editorInstance = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const completionDisposable = useRef<monaco.IDisposable | null>(null)
  const inlineDisposable = useRef<monaco.IDisposable | null>(null)
  const ghostRef = useRef('')

  useEffect(() => {
    let cancelled = false
    loader
      .init()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
      completionDisposable.current?.dispose()
      inlineDisposable.current?.dispose()
    }
  }, [])

  useEffect(() => {
    ghostRef.current = ghostText
    const ed = editorInstance.current
    if (!ed) return
    if (ghostText) {
      ed.trigger('evidence-tailor', 'editor.action.inlineSuggest.trigger', {})
    } else {
      ed.trigger('evidence-tailor', 'editor.action.inlineSuggest.hide', {})
    }
  }, [ghostText])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'light' ? 'resume-light' : 'resume-dark')
  }, [theme, ready])

  useEffect(() => {
    const ed = editorInstance.current
    const model = ed?.getModel()
    if (!model || !relativePath) return

    const report = analyzeRecruiterLens(content, jobDescription)
    const markers: monaco.editor.IMarkerData[] = report.hierarchy.map((issue) => {
      const line = Math.max(1, Number(issue.lineHint) || 1)
      const lineLen = model.getLineLength(Math.min(line, model.getLineCount())) || 1
      return {
        severity: severityOf(issue.severity),
        message: issue.message,
        startLineNumber: Math.min(line, model.getLineCount()),
        startColumn: 1,
        endLineNumber: Math.min(line, model.getLineCount()),
        endColumn: lineLen + 1,
        source: 'Recruiter Lens',
        code: issue.id,
      }
    })
    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers)
  }, [content, jobDescription, relativePath, ready])

  const showEditor = lensMode === 'edit'

  return (
    <section className="editor-pane">
      {tabs.length ? (
        <div className="editor-tabs" role="tablist" aria-label="Open files">
          {tabs.map((tab) => {
            const active = tab.path === activePath
            const name = tab.relativePath.split('/').pop() || tab.relativePath
            return (
              <div
                key={tab.path}
                role="tab"
                aria-selected={active}
                title={tab.relativePath}
                className={`editor-tab ${active ? 'active' : ''} ${tab.dirty ? 'dirty' : ''}`}
                onMouseDown={(e) => {
                  // Middle-click closes, matching editor convention.
                  if (e.button === 1) {
                    e.preventDefault()
                    onCloseTab?.(tab.path)
                  } else if (e.button === 0) {
                    onSelectTab?.(tab.path)
                  }
                }}
              >
                <FileText size={12} strokeWidth={1.75} />
                <span className="editor-tab-name">{name}</span>
                <button
                  type="button"
                  className="editor-tab-close"
                  aria-label={`Close ${name}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab?.(tab.path)
                  }}
                >
                  {tab.dirty ? <span className="editor-tab-dot" aria-hidden="true" /> : null}
                  <X size={12} strokeWidth={2} className="editor-tab-x" />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="pane-header editor-header">
          <span className="editor-header-path" title={relativePath || undefined}>
            {relativePath ? <FileText size={13} strokeWidth={1.75} /> : null}
            {relativePath || 'No file open'}
          </span>
        </div>
      )}
      {relativePath ? (
        <RecruiterLens
          content={content}
          jobDescription={jobDescription}
          mode={lensMode}
          onModeChange={onLensModeChange}
        />
      ) : null}
      {showEditor && ghostText ? (
        <div className="ghost-bar" role="status">
          <span className="ghost-bar-label">
            {ghostLabel}
            {ghostStreaming ? ' · streaming…' : ''}
          </span>
          <div className="ghost-bar-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={onGhostDismiss}
              disabled={!onGhostDismiss}
            >
              Ignore
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={onGhostAccept}
              disabled={!onGhostAccept || ghostStreaming}
            >
              Accept
            </button>
          </div>
        </div>
      ) : null}
      {showEditor ? (
        <div className="editor-wrap">
          {actionBar && onAiAction ? (
            <div
              className="ai-actionbar"
              style={{ top: actionBar.top, left: actionBar.left }}
              role="toolbar"
              aria-label="AI actions for selection"
            >
              <span className="ai-actionbar-label">
                <Sparkles size={12} strokeWidth={2} />
                AI
              </span>
              {AI_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="ai-action"
                  disabled={aiBusy}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onAiAction(action.instruction)
                    setActionBar(null)
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
          {!relativePath ? (
            <div className="editor-empty">
              <EmptyState
                icon={FileText}
                title="No document open"
                description="Select base-resume.md, or any file under resumes/, to start editing."
              />
            </div>
          ) : error ? (
            <textarea
              className="editor-fallback"
              value={content}
              onChange={(e) => onChange(e.target.value)}
              spellCheck={false}
            />
          ) : !ready ? (
            <div className="editor-empty">Loading editor…</div>
          ) : (
            <Editor
              height="100%"
              language="markdown"
              path={relativePath ?? undefined}
              theme={theme === 'light' ? 'resume-light' : 'resume-dark'}
              value={content}
              loading={<div className="editor-empty">Loading editor…</div>}
              onChange={(v) => onChange(v ?? '')}
              onMount={(ed) => {
                editorInstance.current = ed
                onMount(ed)
                ed.onDidChangeCursorSelection(() => {
                  const model = ed.getModel()
                  const sel = ed.getSelection()
                  if (!model || !sel) {
                    onSelectionChange('')
                    setActionBar(null)
                    return
                  }
                  const text = model.getValueInRange(sel)
                  onSelectionChange(text)

                  // Anchor the action bar just above the selection start.
                  if (!text.trim() || sel.isEmpty()) {
                    setActionBar(null)
                    return
                  }
                  const pos = ed.getScrolledVisiblePosition({
                    lineNumber: sel.startLineNumber,
                    column: sel.startColumn,
                  })
                  if (!pos) {
                    setActionBar(null)
                    return
                  }
                  setActionBar({ top: Math.max(4, pos.top - 38), left: Math.max(8, pos.left) })
                })

                ed.onDidScrollChange(() => setActionBar(null))
                ed.onDidBlurEditorWidget(() => setActionBar(null))

                inlineDisposable.current?.dispose()
                inlineDisposable.current = monaco.languages.registerInlineCompletionsProvider(
                  'markdown',
                  {
                    provideInlineCompletions(_model, position) {
                      const text = ghostRef.current
                      if (!text) return { items: [] }
                      return {
                        items: [
                          {
                            insertText: text,
                            range: new monaco.Range(
                              position.lineNumber,
                              position.column,
                              position.lineNumber,
                              position.column,
                            ),
                          },
                        ],
                      }
                    },
                    freeInlineCompletions() {
                      // no resources held per-completion
                    },
                  },
                )

                completionDisposable.current?.dispose()
                completionDisposable.current = monaco.languages.registerCompletionItemProvider(
                  'markdown',
                  {
                    triggerCharacters: ['#', '-', '/'],
                    provideCompletionItems(model, position) {
                      const word = model.getWordUntilPosition(position)
                      const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn,
                      }
                      const suggestions: monaco.languages.CompletionItem[] = [
                        {
                          label: '## Summary',
                          kind: monaco.languages.CompletionItemKind.Snippet,
                          insertText: '## Summary\n\n',
                          range,
                          detail: 'Resume section',
                        },
                        {
                          label: '## Experience',
                          kind: monaco.languages.CompletionItemKind.Snippet,
                          insertText: '## Experience\n\n',
                          range,
                          detail: 'Resume section',
                        },
                        {
                          label: '## Skills',
                          kind: monaco.languages.CompletionItemKind.Snippet,
                          insertText: '## Skills\n\n',
                          range,
                          detail: 'Resume section',
                        },
                        {
                          label: 'Achievement bullet',
                          kind: monaco.languages.CompletionItemKind.Snippet,
                          insertText: achievementSnippetTemplate(),
                          range,
                          detail: 'Action + Metric + Impact + Tool',
                        },
                      ]
                      return { suggestions }
                    },
                  },
                )
              }}
              options={{
                fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
                fontSize: 14,
                lineHeight: 21,
                fontWeight: '400',
                minimap: { enabled: false },
                wordWrap: 'on',
                lineNumbers: 'on',
                lineNumbersMinChars: 4,
                glyphMargin: false,
                folding: true,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 8, bottom: 8 },
                renderLineHighlight: 'all',
                cursorBlinking: 'smooth',
                smoothScrolling: true,
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                inlineSuggest: { enabled: true },
              }}
            />
          )}
        </div>
      ) : null}
    </section>
  )
}
