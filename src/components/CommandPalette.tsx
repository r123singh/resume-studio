import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../../electron/preload'
import { flattenTreeFiles, listMarkdownSections } from '../lib/markdown-nav'

export type PaletteCommand = {
  id: string
  label: string
  hint?: string
  group: 'command' | 'file' | 'section' | 'search'
  run: () => void | Promise<void>
}

type SearchHit = {
  path: string
  relativePath: string
  line: number
  preview: string
}

type Props = {
  open: boolean
  mode: 'commands' | 'files'
  workspace: string | null
  tree: TreeNode[]
  content: string
  commands: PaletteCommand[]
  onClose: () => void
  onOpenFile: (node: TreeNode, line?: number) => void | Promise<void>
  onGoToLine: (line: number) => void
}

export function CommandPalette({
  open,
  mode,
  workspace,
  tree,
  content,
  commands,
  onClose,
  onOpenFile,
  onGoToLine,
}: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    setSearchHits([])
    const t = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(t)
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !workspace) return
    const q = query.trim()
    if (q.length < 2 || mode !== 'commands') {
      setSearchHits([])
      return
    }
    // Content search when query starts with # or user types longer phrases
    const wantSearch = q.startsWith('/') || q.length >= 3
    if (!wantSearch) {
      setSearchHits([])
      return
    }
    let cancelled = false
    const handle = window.setTimeout(() => {
      setSearching(true)
      const term = q.startsWith('/') ? q.slice(1).trim() : q
      void window.resumeStudio
        .searchWorkspace(workspace, term)
        .then((hits) => {
          if (!cancelled) setSearchHits(hits)
        })
        .catch(() => {
          if (!cancelled) setSearchHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [query, workspace, open, mode])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\//, '')
    const out: PaletteCommand[] = []

    if (mode === 'files' || query.startsWith('@')) {
      const files = flattenTreeFiles(tree)
      for (const f of files) {
        if (!q || f.relativePath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) {
          out.push({
            id: `file:${f.path}`,
            label: f.relativePath,
            hint: 'Open file',
            group: 'file',
            run: () => void onOpenFile(f),
          })
        }
      }
    }

    if (mode === 'commands' && !query.startsWith('@')) {
      for (const c of commands) {
        if (
          !q ||
          c.label.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          (c.hint || '').toLowerCase().includes(q)
        ) {
          out.push(c)
        }
      }

      if (content.trim()) {
        for (const s of listMarkdownSections(content)) {
          if (!q || s.title.toLowerCase().includes(q)) {
            out.push({
              id: `section:${s.line}:${s.title}`,
              label: `${'#'.repeat(s.level)} ${s.title}`,
              hint: `Line ${s.line}`,
              group: 'section',
              run: () => onGoToLine(s.line),
            })
          }
        }
      }

      for (const hit of searchHits) {
        out.push({
          id: `search:${hit.relativePath}:${hit.line}:${hit.preview}`,
          label: `${hit.relativePath}:${hit.line}`,
          hint: hit.preview,
          group: 'search',
          run: async () => {
            await onOpenFile(
              {
                name: hit.relativePath.split('/').pop() || hit.relativePath,
                path: hit.path,
                relativePath: hit.relativePath,
                type: 'file',
              },
              hit.line,
            )
          },
        })
      }
    }

    return out.slice(0, 60)
  }, [mode, query, tree, commands, content, searchHits, onOpenFile, onGoToLine])

  useEffect(() => {
    setActive(0)
  }, [items.length, query])

  if (!open) return null

  const runActive = () => {
    const item = items[active]
    if (!item) return
    void Promise.resolve(item.run()).then(() => {
      if (item.id === 'goto-file') return
      onClose()
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(0, items.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runActive()
    }
  }

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal palette-modal"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'files' ? 'Go to file' : 'Command palette'}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            mode === 'files'
              ? 'Go to file…'
              : 'Commands, sections, or /search workspace…'
          }
          aria-autocomplete="list"
          aria-controls="palette-list"
        />
        <div className="palette-hint muted">
          {mode === 'files'
            ? 'Ctrl+P · Enter to open · Esc to close'
            : 'Ctrl+Shift+P · @file · /text search · ↑↓ Enter · Esc'}
          {searching ? ' · Searching…' : ''}
        </div>
        <ul id="palette-list" className="palette-list" role="listbox">
          {items.length === 0 ? (
            <li className="palette-empty">No matches</li>
          ) : (
            items.map((item, idx) => (
              <li key={item.id} role="option" aria-selected={idx === active}>
                <button
                  type="button"
                  className={`palette-item ${idx === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => {
                    void Promise.resolve(item.run()).then(() => {
                      if (item.id === 'goto-file') return
                      onClose()
                    })
                  }}
                >
                  <span className={`palette-group ${item.group}`}>{item.group}</span>
                  <span className="palette-label">{item.label}</span>
                  {item.hint ? <span className="palette-item-hint">{item.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
