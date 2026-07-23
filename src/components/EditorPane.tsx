import Editor, { loader } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEffect, useState } from 'react'

type Props = {
  content: string
  relativePath: string | null
  onChange: (value: string) => void
  onSelectionChange: (text: string) => void
  onMount: (editor: MonacoEditor.IStandaloneCodeEditor) => void
}

export function EditorPane({
  content,
  relativePath,
  onChange,
  onSelectionChange,
  onMount,
}: Props) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    }
  }, [])

  return (
    <section className="editor-pane">
      <div className="pane-header">{relativePath || 'No file open'}</div>
      <div className="editor-wrap">
        {!relativePath ? (
          <div className="editor-empty">
            Select <code>base-resume.md</code> or a file under <code>resumes/</code>.
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
            theme="vs-dark"
            value={content}
            loading={<div className="editor-empty">Loading editor…</div>}
            onChange={(v) => onChange(v ?? '')}
            onMount={(ed) => {
              onMount(ed)
              ed.onDidChangeCursorSelection(() => {
                const model = ed.getModel()
                const sel = ed.getSelection()
                if (!model || !sel) {
                  onSelectionChange('')
                  return
                }
                onSelectionChange(model.getValueInRange(sel))
              })
            }}
            options={{
              fontFamily: '"IBM Plex Mono", Consolas, monospace',
              fontSize: 14,
              minimap: { enabled: false },
              wordWrap: 'on',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 12 },
            }}
          />
        )}
      </div>
    </section>
  )
}
