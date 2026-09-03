import './styles/app.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import {
  ClipboardList,
  Compass,
  FileSearch,
  Files,
  Layers,
  ListTree,
  PanelLeftClose,
  PanelRightClose,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { TopBar } from './components/TopBar'
import { Explorer, type SidebarView } from './components/Explorer'
import { StatusBar } from './components/StatusBar'
import { ActivityRail, type RailItem } from './components/ActivityRail'
import { IconButton } from './components/ui/IconButton'
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  watchSystemTheme,
  type ThemePreference,
} from './lib/theme'
import { EditorPane } from './components/EditorPane'
import { SidePanel } from './components/SidePanel'
import type { ApplicationRow, JobListing, PanelMode } from './components/SidePanel'
import { SettingsPane } from './components/SettingsModal'
import { Welcome } from './components/Welcome'
import { CommandPalette, type PaletteCommand } from './components/CommandPalette'
import { AchievementBuilder } from './components/AchievementBuilder'
import { GitPanel } from './components/GitPanel'
import type { TreeNode } from '../electron/preload'
import { markdownToPrintHtml } from './lib/pdf'
import { resumeFileName } from './lib/slug'
import {
  buildApplyKitParts,
  buildChecklistMarkdown,
  buildCoverLetterFile,
  buildFormSnippetsFile,
  buildResumeMarkdownFile,
  kitFolderName,
  parseFrontmatter,
} from './lib/apply-kit'
import {
  buildEditSystemPrompt,
  buildEditUserPrompt,
  buildInterviewPrepSystemPrompt,
  buildInterviewPrepUserPrompt,
  buildTailorSystemPrompt,
  buildTailorUserPrompt,
  parseEditResponse,
  stripCodeFences,
} from './lib/ai/prompts'
import {
  completeChat,
  streamChat,
  formatAttribution,
  runAgent,
  supportsAgentMode,
  type AgentToolEvent,
  type ProviderId,
} from './lib/ai/providers'
import { analyzeRecruiterLens, type LensMode } from './lib/recruiter-lens'
import { isLargeEdit } from './lib/ai/diff'
import { assertRateLimit, type PendingEdit } from './lib/ai/safety'
import {
  estimateMessagesTokens,
  MAX_JD_CHARS,
  MAX_RESUME_CHARS,
  retrieveRelevantSections,
  truncateText,
} from './lib/ai/retrieval'
import { DiffPreviewModal, type DiffEvidence } from './components/DiffPreviewModal'
import { EvidencePanel } from './components/EvidencePanel'
import type { JobContext } from '../electron/preload'
import {
  applyEvidenceSuggestions,
  buildEvidenceSystemPrompt,
  buildEvidenceUserPrompt,
  extractPartialBullets,
  parseEvidenceResponse,
  suggestionsToGhostText,
  type EvidenceSuggestion,
} from './lib/ai/evidence'

const SIDEBAR_RAIL_ITEMS: RailItem<SidebarView>[] = [
  { id: 'files', icon: Files, label: 'Explorer', shortcut: 'Ctrl+Shift+F' },
  { id: 'outline', icon: ListTree, label: 'Resume outline', shortcut: 'Ctrl+Shift+O' },
]

const INSPECTOR_RAIL_ITEMS: RailItem<PanelMode>[] = [
  { id: 'edit', icon: Sparkles, label: 'AI assistant' },
  { id: 'evidence', icon: FileSearch, label: 'Evidence-backed tailor', shortcut: 'Ctrl+Shift+E' },
  { id: 'tailor', icon: Wand2, label: 'Tailor from job description' },
  { id: 'hunt', icon: Compass, label: 'Job hunt' },
  { id: 'tracker', icon: ClipboardList, label: 'Application tracker' },
  { id: 'roles', icon: Layers, label: 'Role variants' },
]

type ChatItem = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attribution?: string
  streaming?: boolean
  feedback?: 'up' | 'down'
  provider?: string
  model?: string
  /** Tool activity trail for agent turns. */
  tools?: AgentToolEvent[]
}

/**
 * One open editor tab. The single-file buffer state below always mirrors the
 * active tab; this registry snapshots every open file so switching tabs keeps
 * each file's unsaved edits, dirty flag, and last-saved time.
 */
type OpenDoc = {
  path: string
  relativePath: string
  content: string
  dirty: boolean
  lastSavedAt: number | null
}

export default function App() {
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [activeRel, setActiveRel] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [openDocs, setOpenDocs] = useState<OpenDoc[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [chat, setChat] = useState<ChatItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Open a workspace, paste a JD in Tailor mode, then click Apply kit for PDF + cover letter + form snippets + checklist.',
    },
  ])
  const [selection, setSelection] = useState('')
  const [applications, setApplications] = useState<ApplicationRow[]>([])
  const [focusTracker, setFocusTracker] = useState(false)
  const [huntQuery, setHuntQuery] = useState('senior product manager AI')
  const [huntResults, setHuntResults] = useState<JobListing[]>([])
  const [huntSelectedIds, setHuntSelectedIds] = useState<Set<string>>(new Set())
  const [lensJd, setLensJd] = useState('')
  const [lensMode, setLensMode] = useState<LensMode>('edit')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteMode, setPaletteMode] = useState<'commands' | 'files'>('commands')
  const [achievementOpen, setAchievementOpen] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const [gitSummary, setGitSummary] = useState('')
  const [focusRoles, setFocusRoles] = useState(false)
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null)
  const [streamPreview, setStreamPreview] = useState('')
  const [streamBusy, setStreamBusy] = useState(false)
  const [confirmLargeEdits, setConfirmLargeEdits] = useState(true)
  const [allowWebResearch, setAllowWebResearch] = useState(false)
  const [agentMode, setAgentMode] = useState(true)
  const [provider, setProvider] = useState<ProviderId>('nvidia')
  const [model, setModel] = useState('')
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference())
  const [sidebarView, setSidebarView] = useState<SidebarView>('files')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [inspectorView, setInspectorView] = useState<PanelMode>('edit')
  const [sidebarWidth, setSidebarWidth] = useState(248)
  const [inspectorWidth, setInspectorWidth] = useState(380)
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 })
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidencePasted, setEvidencePasted] = useState('')
  const [evidenceInstruction, setEvidenceInstruction] = useState('')
  const [evidenceContext, setEvidenceContext] = useState<JobContext | null>(null)
  const [evidenceSuggestions, setEvidenceSuggestions] = useState<EvidenceSuggestion[]>([])
  const [evidencePinned, setEvidencePinned] = useState<string[]>([])
  const [evidenceAtsFit, setEvidenceAtsFit] = useState(0)
  const [evidenceNote, setEvidenceNote] = useState('')
  const [evidenceError, setEvidenceError] = useState('')
  const [researching, setResearching] = useState(false)
  const [focusEvidence, setFocusEvidence] = useState(false)
  const [ghostText, setGhostText] = useState('')
  const [ghostStreaming, setGhostStreaming] = useState(false)
  const [pendingEvidence, setPendingEvidence] = useState<DiffEvidence[]>([])
  const [pendingCommitMsg, setPendingCommitMsg] = useState('')
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const selectionRangeRef = useRef<{
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  } | null>(null)


  const refreshTree = useCallback(async (root: string) => {
    const nodes = await window.resumeStudio.listWorkspace(root)
    setTree(nodes)
  }, [])

  const refreshApplications = useCallback(async () => {
    if (!workspace) {
      setApplications([])
      return
    }
    const rows = await window.resumeStudio.listApplications(workspace)
    setApplications(rows)
  }, [workspace])

  const openWorkspace = useCallback(
    async (root: string) => {
      // A new folder invalidates every open tab (their paths belong to the old
      // workspace), so reset the editor buffer and the tab registry.
      setOpenDocs([])
      setActivePath(null)
      setActiveRel(null)
      setContent('')
      setDirty(false)
      setLastSavedAt(null)
      setWorkspace(root)
      await refreshTree(root)
      setStatus(`Workspace: ${root}`)
      await window.resumeStudio.setSettings({ lastWorkspace: root })
      const rows = await window.resumeStudio.listApplications(root)
      setApplications(rows)
    },
    [refreshTree],
  )

  useEffect(() => {
    ;(async () => {
      const s = await window.resumeStudio.getSettings()
      if (s.lastWorkspace) {
        try {
          await openWorkspace(s.lastWorkspace)
        } catch {
          setStatus('Choose a workspace folder to begin')
        }
      }
      setConfirmLargeEdits(s.confirmLargeEdits !== false)
      setAllowWebResearch(Boolean(s.allowWebResearch))
      setAgentMode(s.agentMode !== false)
      setProvider(s.provider)
      setModel(s.model)
    })()
  }, [openWorkspace])

  useEffect(() => {
    applyTheme(theme)
    return watchSystemTheme(theme, () => undefined)
  }, [theme])

  const cycleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : prev === 'light' ? 'system' : 'dark'))
  }, [])

  /** Drag-to-resize for the two side panels. */
  const startResize = useCallback(
    (side: 'sidebar' | 'inspector') => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = side === 'sidebar' ? sidebarWidth : inspectorWidth
      const el = e.currentTarget
      el.classList.add('dragging')
      el.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const delta = side === 'sidebar' ? ev.clientX - startX : startX - ev.clientX
        const next = Math.min(560, Math.max(200, startWidth + delta))
        if (side === 'sidebar') setSidebarWidth(next)
        else setInspectorWidth(next)
      }
      const onUp = () => {
        el.classList.remove('dragging')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [sidebarWidth, inspectorWidth],
  )

  const pushChat = (
    role: ChatItem['role'],
    contentText: string,
    extra?: Partial<ChatItem>,
  ) => {
    const id = `${Date.now()}-${Math.random()}`
    setChat((prev) => [...prev, { id, role, content: contentText, ...extra }])
    return id
  }

  const updateChat = (id: string, patch: Partial<ChatItem>) => {
    setChat((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  const applyAcceptedEdit = async (edit: PendingEdit) => {
    if (edit.mode === 'create-file' && edit.createPath && edit.createRel && workspace) {
      await window.resumeStudio.writeFile(edit.createPath, edit.after)
      await refreshTree(workspace)
      openBufferAsTab(edit.createPath, edit.createRel, edit.after, { dirty: false })
      setStatus(`Created ${edit.createRel}`)
      return
    }

    const ed = editorRef.current
    if (edit.mode === 'selection' && ed && edit.selectionRange) {
      ed.pushUndoStop()
      ed.executeEdits('ai-edit-grouped', [
        {
          range: edit.selectionRange,
          text: edit.after,
          forceMoveMarkers: true,
        },
      ])
      ed.pushUndoStop()
      const next = ed.getValue()
      setContent(next)
      setDirty(true)
    } else if (ed) {
      ed.pushUndoStop()
      const model = ed.getModel()
      if (model) {
        ed.executeEdits('ai-edit-grouped', [
          {
            range: model.getFullModelRange(),
            text: edit.after,
            forceMoveMarkers: true,
          },
        ])
      } else {
        ed.setValue(edit.after)
      }
      ed.pushUndoStop()
      setContent(edit.after)
      setDirty(true)
    } else {
      setContent(edit.after)
      setDirty(true)
    }
    setStatus('AI edit applied (unsaved) — Ctrl+Z undoes as one step')
  }

  const pickFolder = async () => {
    const root = await window.resumeStudio.openFolder()
    if (root) await openWorkspace(root)
  }

  // Keep the tab registry in step with the active buffer, so an inactive tab
  // always holds the latest edits made while it was focused. No dependency
  // loop: this only writes openDocs, which is not a dependency.
  useEffect(() => {
    if (!activePath) return
    setOpenDocs((prev) =>
      prev.map((d) =>
        d.path === activePath
          ? { ...d, content, dirty, lastSavedAt, relativePath: activeRel ?? d.relativePath }
          : d,
      ),
    )
  }, [activePath, activeRel, content, dirty, lastSavedAt])

  /** Open a file into a tab (adding it if new) and make it the active buffer. */
  const openBufferAsTab = (
    path: string,
    relativePath: string,
    text: string,
    opts?: { dirty?: boolean; lastSavedAt?: number | null },
  ) => {
    const isDirty = opts?.dirty ?? false
    const saved = opts?.lastSavedAt ?? null
    setOpenDocs((prev) =>
      prev.some((d) => d.path === path)
        ? prev.map((d) =>
            d.path === path
              ? { ...d, relativePath, content: text, dirty: isDirty, lastSavedAt: saved }
              : d,
          )
        : [...prev, { path, relativePath, content: text, dirty: isDirty, lastSavedAt: saved }],
    )
    setActivePath(path)
    setActiveRel(relativePath)
    setContent(text)
    setDirty(isDirty)
    setLastSavedAt(saved)
  }

  /** Switch to an already-open tab, restoring its in-memory (unsaved) content. */
  const switchTab = (path: string) => {
    const doc = openDocs.find((d) => d.path === path)
    if (!doc) return
    setActivePath(doc.path)
    setActiveRel(doc.relativePath)
    setContent(doc.content)
    setDirty(doc.dirty)
    setLastSavedAt(doc.lastSavedAt)
    setLensMode('edit')
  }

  const closeTab = (path: string) => {
    const doc = openDocs.find((d) => d.path === path)
    if (!doc) return
    if (doc.dirty && !window.confirm(`Discard unsaved changes to ${doc.relativePath}?`)) return
    const idx = openDocs.findIndex((d) => d.path === path)
    const remaining = openDocs.filter((d) => d.path !== path)
    setOpenDocs(remaining)
    if (path !== activePath) return
    // Focus the neighbour tab, matching editor convention (right, else left).
    const nextDoc = remaining[idx] ?? remaining[idx - 1] ?? remaining[remaining.length - 1] ?? null
    if (nextDoc) {
      setActivePath(nextDoc.path)
      setActiveRel(nextDoc.relativePath)
      setContent(nextDoc.content)
      setDirty(nextDoc.dirty)
      setLastSavedAt(nextDoc.lastSavedAt)
    } else {
      setActivePath(null)
      setActiveRel(null)
      setContent('')
      setDirty(false)
      setLastSavedAt(null)
    }
  }

  // Closing settings re-reads persisted values so provider/model/flag changes
  // made in the pane take effect in the running session immediately.
  const closeSettings = () => {
    setSettingsOpen(false)
    void window.resumeStudio.getSettings().then((s) => {
      setConfirmLargeEdits(s.confirmLargeEdits !== false)
      setAllowWebResearch(Boolean(s.allowWebResearch))
      setAgentMode(s.agentMode !== false)
      setProvider(s.provider)
      setModel(s.model)
    })
  }

  const openFile = async (node: TreeNode, line?: number) => {
    if (node.type !== 'file') return
    const existing = openDocs.find((d) => d.path === node.path)
    if (existing) {
      switchTab(existing.path)
    } else {
      const text = await window.resumeStudio.readFile(node.path)
      openBufferAsTab(node.path, node.relativePath, text, { dirty: false })
    }
    setLensMode('edit')
    setStatus(`Opened ${node.relativePath}`)
    if (line && line > 0) {
      window.setTimeout(() => {
        const ed = editorRef.current
        if (!ed) return
        ed.revealLineInCenter(line)
        ed.setPosition({ lineNumber: line, column: 1 })
        ed.focus()
      }, 80)
    }
  }

  const openAbsolute = async (absolutePath: string, relativePath: string) => {
    await openFile({
      name: relativePath.split('/').pop() || relativePath,
      path: absolutePath,
      relativePath,
      type: 'file',
    })
  }

  const goToLine = (line: number) => {
    setLensMode('edit')
    const ed = editorRef.current
    if (!ed) return
    ed.revealLineInCenter(line)
    ed.setPosition({ lineNumber: line, column: 1 })
    ed.focus()
  }

  const insertAtCursor = (text: string) => {
    const ed = editorRef.current
    if (!ed) {
      setContent((c) => `${c.trimEnd()}\n${text}\n`)
      setDirty(true)
      return
    }
    const sel = ed.getSelection()
    const model = ed.getModel()
    if (!model || !sel) return
    ed.executeEdits('achievement-builder', [
      {
        range: sel,
        text: text.endsWith('\n') ? text : `${text}\n`,
        forceMoveMarkers: true,
      },
    ])
    setContent(model.getValue())
    setDirty(true)
    setLensMode('edit')
  }

  const saveFile = async () => {
    if (!activePath) return
    await window.resumeStudio.writeFile(activePath, content)
    setDirty(false)
    setLastSavedAt(Date.now())
    setStatus(`Saved ${activeRel}`)
    if (workspace) await refreshTree(workspace)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveFile()
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteMode('commands')
        setPaletteOpen(true)
        return
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteMode('files')
        setPaletteOpen(true)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        if (workspace) setGitOpen(true)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setInspectorView('evidence')
        setInspectorOpen(true)
        setFocusEvidence(true)
        window.setTimeout(() => setFocusEvidence(false), 400)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setAchievementOpen(true)
        return
      }
      // Ctrl+K is the primary palette entry point; Ctrl+Shift+P still works.
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteMode('commands')
        setPaletteOpen(true)
        return
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
        return
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setInspectorOpen((v) => !v)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setSidebarView('outline')
        setSidebarOpen(true)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSidebarView('files')
        setSidebarOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [activePath, content, activeRel, workspace, dirty])

  useEffect(() => {
    if (!workspace) {
      setGitSummary('')
      return
    }
    let cancelled = false
    void window.resumeStudio
      .gitStatus(workspace)
      .then((s) => {
        if (cancelled) return
        setGitSummary(s.isRepo ? `${s.branch || 'git'}: ${s.summary}` : '')
      })
      .catch(() => {
        if (!cancelled) setGitSummary('')
      })
    return () => {
      cancelled = true
    }
  }, [workspace, dirty, activePath])

  const getApiContext = async () => {
    const secrets = await window.resumeStudio.getSecrets()
    return {
      provider: secrets.provider as ProviderId,
      model: secrets.model,
      workspace,
    }
  }

  const readBaseResume = async () => {
    if (!workspace) return ''
    const basePath = await window.resumeStudio.pathJoin(workspace, 'base-resume.md')
    try {
      return await window.resumeStudio.readFile(basePath)
    } catch {
      return ''
    }
  }

  const runTailorFromJd = async (
    input: {
      company: string
      role: string
      location: string
      jobUrl: string
      jobDescription: string
    },
    opts?: { buildKit?: boolean; focusTracker?: boolean },
  ) => {
    if (!workspace) {
      throw new Error('Open a workspace folder first.')
    }
    if (!input.company.trim() || !input.role.trim() || !input.jobDescription.trim()) {
      throw new Error('Company, role, and job description are required.')
    }

    assertRateLimit()
    pushChat('user', `Tailor resume for ${input.role} at ${input.company}`)
    setLensJd(input.jobDescription)
    const base = await readBaseResume()
    if (!base.trim()) {
      throw new Error('base-resume.md is empty. Add your master resume first.')
    }
    const ctx = await getApiContext()
    const today = new Date().toISOString().slice(0, 10)
    const trimmedJd = truncateText(input.jobDescription, MAX_JD_CHARS)
    const trimmedBase = retrieveRelevantSections(base, `${input.role} ${trimmedJd}`, MAX_RESUME_CHARS)
    const messages = [
      { role: 'system' as const, content: buildTailorSystemPrompt() },
      {
        role: 'user' as const,
        content: buildTailorUserPrompt({
          baseResume: trimmedBase,
          company: input.company,
          role: input.role,
          location: input.location,
          jobUrl: input.jobUrl,
          jobDescription: trimmedJd,
          today,
        }),
      },
    ]
    const streamId = pushChat('assistant', 'Tailoring…', {
      streaming: true,
      attribution: `${ctx.provider} / ${ctx.model} · ~${estimateMessagesTokens(messages)} tok in`,
    })
    setStreamBusy(true)
    setStreamPreview('')
    setPendingEdit({
      id: streamId,
      title: `Tailor preview — ${input.role} @ ${input.company}`,
      before: '',
      after: '',
      mode: 'create-file',
      note: 'Review the tailored resume before it is written to disk.',
      createPath: '',
      createRel: '',
      meta: {
        buildKit: opts?.buildKit === false ? '0' : '1',
        company: input.company,
        role: input.role,
        focusTracker: opts?.focusTracker ? '1' : '0',
      },
    })

    try {
      const result = await streamChat({
        ...ctx,
        capability: 'resume_generation',
        messages,
        onChunk: (_chunk, assembled) => {
          setStreamPreview(assembled)
          updateChat(streamId, {
            content: assembled.slice(-1200) || 'Tailoring…',
            streaming: true,
          })
        },
      })
      const markdown = stripCodeFences(result.text)
      const fileName = resumeFileName(input.company, input.role)
      const resumesDir = await window.resumeStudio.ensureResumesDir(workspace)
      const outPath = await window.resumeStudio.pathJoin(resumesDir, fileName)
      const attr = formatAttribution(result)
      updateChat(streamId, {
        content: `Ready to create resumes/${fileName}. Accept the diff to write.`,
        streaming: false,
        attribution: attr,
        provider: result.provider,
        model: result.model,
      })
      setPendingEdit({
        id: streamId,
        title: `Tailor preview — ${input.role} @ ${input.company}`,
        before: base.slice(0, 20_000),
        after: markdown,
        mode: 'create-file',
        note: `Will write resumes/${fileName}${opts?.buildKit === false ? '' : ' and build Apply kit'}.`,
        createPath: outPath,
        createRel: `resumes/${fileName}`,
        meta: {
          buildKit: opts?.buildKit === false ? '0' : '1',
          company: input.company,
          role: input.role,
          focusTracker: opts?.focusTracker ? '1' : '0',
        },
      })
      setStreamPreview('')
      setStatus(`Preview ready · ${attr}`)
    } catch (err) {
      setPendingEdit(null)
      setStreamPreview('')
      updateChat(streamId, {
        content: err instanceof Error ? err.message : String(err),
        streaming: false,
      })
      throw err
    } finally {
      setStreamBusy(false)
    }
  }

  const tailorFromJd = async (input: {
    company: string
    role: string
    location: string
    jobUrl: string
    jobDescription: string
  }) => {
    if (!workspace) {
      pushChat('assistant', 'Open a workspace folder first.')
      return
    }
    setBusy(true)
    try {
      await runTailorFromJd(input, { focusTracker: true })
    } catch (err) {
      pushChat('assistant', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const buildAndWriteApplyKit = async (
    sourceMarkdown: string,
    opts?: { company?: string; role?: string; sourceRel?: string; focusTracker?: boolean },
  ) => {
    if (!workspace) throw new Error('Open a workspace folder first.')
    const source = sourceMarkdown.trim()
    if (!source) throw new Error('Open a tailored resume markdown file first.')

    const parts = buildApplyKitParts(source, {
      company: opts?.company,
      role: opts?.role,
    })
    const slug = kitFolderName(parts)
    const resumeMd = buildResumeMarkdownFile(parts)
    const pdfHtml = markdownToPrintHtml(resumeMd, `${parts.company} — ${parts.role}`)

    const result = await window.resumeStudio.writeApplyKit({
      workspace,
      kitSlug: slug,
      files: {
        'resume.md': resumeMd,
        'cover-letter.md': buildCoverLetterFile(parts),
        'form-snippets.md': buildFormSnippetsFile(parts),
        'CHECKLIST.md': buildChecklistMarkdown(parts),
      },
      pdfHtml,
      tracker: {
        company: parts.company,
        role: parts.role,
        location: parts.location,
        jobUrl: parts.jobUrl,
        notes: `kit: apply-kits/${slug}/; resume: ${opts?.sourceRel || activeRel || 'editor'}`,
      },
    })

    await refreshTree(workspace)
    await refreshApplications()
    pushChat(
      'assistant',
      `Apply kit ready: apply-kits/${slug}/\n• resume.md + resume.pdf\n• cover-letter.md\n• form-snippets.md\n• CHECKLIST.md\nLogged as ready-to-apply — open the Tracker tab to manage status.`,
    )
    setStatus(`Apply kit: apply-kits/${slug}`)
    if (opts?.focusTracker !== false) {
      setInspectorView('tracker')
      setInspectorOpen(true)
      setFocusTracker(true)
      if (result.pdfPath) {
        await window.resumeStudio.showItemInFolder(result.pdfPath)
      } else {
        await window.resumeStudio.openPath(result.kitDir)
      }
    }
  }

  const generateApplyKit = async () => {
    if (!workspace) {
      pushChat('assistant', 'Open a workspace folder first.')
      return
    }
    if (!content.trim()) {
      pushChat('assistant', 'Open a tailored resume markdown file first.')
      return
    }
    setBusy(true)
    try {
      if (dirty && activePath) {
        await window.resumeStudio.writeFile(activePath, content)
        setDirty(false)
      }
      await buildAndWriteApplyKit(content, { sourceRel: activeRel || undefined })
    } catch (err) {
      pushChat('assistant', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runJobHunt = async () => {
    if (!workspace) {
      pushChat('assistant', 'Open a workspace folder first.')
      return
    }
    setBusy(true)
    setStatus('Searching RemoteOK + Remotive…')
    try {
      await window.resumeStudio.ensureJobPreferences(workspace)
      const results = await window.resumeStudio.searchJobs(workspace, huntQuery)
      setHuntResults(results)
      setHuntSelectedIds(new Set())
      pushChat(
        'assistant',
        results.length
          ? `Found ${results.length} ranked roles. Select jobs in Hunt, then Prepare.`
          : 'No strong matches. Edit job-preferences.md or try different keywords.',
      )
      setStatus(`Hunt: ${results.length} results`)
    } catch (err) {
      pushChat('assistant', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const prepareSelectedJobs = async () => {
    if (!workspace) return
    const selected = huntResults.filter((j) => huntSelectedIds.has(j.id) && !j.alreadyTracked)
    if (!selected.length) {
      pushChat('assistant', 'Select at least one job in the Hunt tab.')
      return
    }
    setBusy(true)
    pushChat('user', `Prepare ${selected.length} job(s) from Hunt`)
    let ok = 0
    try {
      for (let i = 0; i < selected.length; i++) {
        const job = selected[i]
        setStatus(`Preparing ${i + 1}/${selected.length}: ${job.company}`)
        await runTailorFromJd(
          {
            company: job.company,
            role: job.title,
            location: job.location,
            jobUrl: job.jobUrl,
            jobDescription:
              job.description ||
              `${job.title} at ${job.company}. Location: ${job.location}. Tags: ${job.tags.join(', ')}`,
          },
          { focusTracker: i === selected.length - 1 },
        )
        ok++
      }
      setHuntSelectedIds(new Set())
      await refreshApplications()
      pushChat('assistant', `Prepared ${ok}/${selected.length} role(s). Check Tracker + apply-kits/.`)
    } catch (err) {
      pushChat(
        'assistant',
        `Stopped after ${ok}/${selected.length}: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const openPreferences = async () => {
    if (!workspace) return
    const prefsPath = await window.resumeStudio.ensureJobPreferences(workspace)
    await refreshTree(workspace)
    const text = await window.resumeStudio.readFile(prefsPath)
    openBufferAsTab(prefsPath, 'job-preferences.md', text, { dirty: false })
    setStatus('Opened job-preferences.md')
  }

  const generateInterviewPrep = async (opts?: {
    markdown?: string
    company?: string
    role?: string
    location?: string
    jobUrl?: string
    jobDescription?: string
    sourceRel?: string
  }) => {
    if (!workspace) {
      pushChat('assistant', 'Open a workspace folder first.')
      return
    }
    const tailored = (opts?.markdown ?? content).trim()
    if (!tailored) {
      pushChat('assistant', 'Open a tailored resume (or select a Tracker row) first.')
      return
    }

    setBusy(true)
    try {
      if (dirty && activePath && !opts?.markdown) {
        await window.resumeStudio.writeFile(activePath, content)
        setDirty(false)
      }

      const { meta } = parseFrontmatter(tailored)
      const company = opts?.company || meta.company || 'Company'
      const role = opts?.role || meta.role || 'Role'
      const location = opts?.location || meta.location || ''
      const jobUrl = opts?.jobUrl || meta.job_url || meta.jobUrl || ''

      let jobDescription = (opts?.jobDescription || '').trim()
      if (!jobDescription) {
        const huntHit = huntResults.find(
          (j) =>
            j.company.toLowerCase() === company.toLowerCase() &&
            j.title.toLowerCase() === role.toLowerCase(),
        )
        jobDescription = huntHit?.description || ''
      }
      if (!jobDescription) {
        const pasted = window.prompt(
          'Optional: paste the job description for stronger prep (Cancel to continue without it).',
          '',
        )
        if (pasted && pasted.trim()) jobDescription = pasted.trim()
      }

      pushChat('user', `Interview prep for ${role} at ${company}`)
      const base = await readBaseResume()
      const ctx = await getApiContext()
      const today = new Date().toISOString().slice(0, 10)
      const raw = await completeChat({
        ...ctx,
        capability: 'interview_prep',
        messages: [
          { role: 'system', content: buildInterviewPrepSystemPrompt() },
          {
            role: 'user',
            content: buildInterviewPrepUserPrompt({
              company,
              role,
              location,
              jobUrl,
              jobDescription,
              tailoredResume: tailored,
              baseResume: base,
              today,
            }),
          },
        ],
      })
      const markdown = stripCodeFences(raw)
      const fileName = resumeFileName(company, role)
      const prepDir = await window.resumeStudio.ensureInterviewPrepDir(workspace)
      const outPath = await window.resumeStudio.pathJoin(prepDir, fileName)
      await window.resumeStudio.writeFile(outPath, markdown)
      await refreshTree(workspace)
      openBufferAsTab(outPath, `interview-prep/${fileName}`, markdown, { dirty: false })
      pushChat(
        'assistant',
        `Interview prep ready: interview-prep/${fileName}${opts?.sourceRel ? ` (from ${opts.sourceRel})` : ''}`,
      )
      setStatus(`Interview prep: ${fileName}`)
    } catch (err) {
      pushChat('assistant', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const interviewPrepFromTrackerRow = async (row: ApplicationRow) => {
    if (!workspace) return
    const resumeMatch = row.notes.match(/resume:\s*(resumes\/[^;\s]+)/i)
    let markdown = ''
    let sourceRel = ''
    if (resumeMatch) {
      sourceRel = resumeMatch[1].replace(/\/$/, '')
      try {
        const full = await window.resumeStudio.pathJoin(workspace, ...sourceRel.split(/[/\\]/))
        markdown = await window.resumeStudio.readFile(full)
      } catch {
        markdown = ''
      }
    }
    if (!markdown.trim()) {
      // Fall back to apply-kit resume.md
      const kitMatch = row.notes.match(/kit:\s*(apply-kits\/[^;\s]+)/i)
      if (kitMatch) {
        const kitRel = kitMatch[1].replace(/\/$/, '')
        try {
          const full = await window.resumeStudio.pathJoin(
            workspace,
            ...kitRel.split(/[/\\]/),
            'resume.md',
          )
          markdown = await window.resumeStudio.readFile(full)
          sourceRel = `${kitRel}/resume.md`
        } catch {
          markdown = ''
        }
      }
    }
    if (!markdown.trim() && content.trim()) {
      markdown = content
      sourceRel = activeRel || 'editor'
    }
    if (!markdown.trim()) {
      pushChat(
        'assistant',
        `No resume found for ${row.company}. Open the tailored resume, then click Interview prep.`,
      )
      return
    }
    await generateInterviewPrep({
      markdown,
      company: row.company,
      role: row.role,
      location: row.location,
      jobUrl: row.jobUrl,
      sourceRel,
    })
  }

  /**
   * Agentic path: the model plans with tools, then hands back edit proposals.
   * Nothing is written until the user accepts the diff.
   */
  const runAgentTask = async (instruction: string) => {
    if (!instruction.trim()) return
    if (!workspace) {
      pushChat('assistant', 'Open a workspace first so the agent can read your resume files.')
      return
    }
    setBusy(true)
    setStreamBusy(true)
    pushChat('user', instruction)
    const streamId = pushChat('assistant', 'Planning…', { streaming: true, tools: [] })
    const tools: AgentToolEvent[] = []

    try {
      assertRateLimit()
      const ctx = await getApiContext()
      const activeRel =
        activePath && workspace
          ? activePath.slice(workspace.length + 1).replace(/\\/g, '/')
          : null

      const result = await runAgent({
        prompt: instruction,
        workspace,
        activeRelativePath: activeRel,
        provider: ctx.provider,
        model: ctx.model,
        onText: (_delta, assembled) => {
          updateChat(streamId, { content: assembled, streaming: true })
          setStreamPreview(assembled)
        },
        onTool: (event) => {
          // Collapse the running entry into its finished state.
          const idx = tools.findIndex((t) => t.name === event.name && t.status === 'running')
          if (idx >= 0) tools[idx] = event
          else tools.push(event)
          updateChat(streamId, { tools: [...tools] })
          setStatus(`Agent · ${event.name} ${event.status}`)
        },
        onStatus: (status) => setStatus(`Agent · ${status}`),
      })

      const attr = formatAttribution({
        provider: result.provider,
        model: result.model,
        approxInputTokens: result.inputTokens,
        approxOutputTokens: result.outputTokens,
      })

      updateChat(streamId, {
        content:
          result.text ||
          (result.proposals.length ? 'Prepared edits for review.' : 'No changes suggested.'),
        streaming: false,
        attribution: `${attr} · ${result.turns} turn(s)`,
        provider: result.provider,
        model: result.model,
        tools: [...tools],
      })

      if (result.stopReason === 'limitTurns' || result.stopReason === 'limitTotalTokens') {
        pushChat(
          'assistant',
          'The agent hit its turn/token budget and stopped early. Narrow the request and try again.',
        )
      }

      const proposal = result.proposals[0]
      if (proposal) {
        if (result.proposals.length > 1) {
          pushChat(
            'assistant',
            `The agent proposed ${result.proposals.length} file changes. Reviewing ${proposal.relativePath} first; re-run for the rest.`,
          )
        }
        setPendingEvidence(
          proposal.evidence.map((id) => ({
            id,
            sourceUrl: '',
            sourceTitle: 'Agent evidence',
            excerpt: id,
          })),
        )
        setPendingEdit({
          id: `agent-${Date.now()}`,
          title: `Agent proposal — ${proposal.relativePath}`,
          before: proposal.before,
          after: proposal.after,
          mode: proposal.before ? 'file' : 'create-file',
          note: proposal.rationale,
          ...(proposal.before
            ? {}
            : {
                createPath: `${workspace}/${proposal.relativePath}`,
                createRel: proposal.relativePath,
              }),
        })
        setStatus(`Agent proposal ready · ${attr}`)
      } else {
        setStatus(`Agent finished · ${attr}`)
      }
    } catch (err) {
      updateChat(streamId, {
        content: err instanceof Error ? err.message : String(err),
        streaming: false,
        tools: [...tools],
      })
    } finally {
      setBusy(false)
      setStreamBusy(false)
      setStreamPreview('')
    }
  }

  const editWithChat = async (instruction: string) => {
    if (agentMode && supportsAgentMode(provider)) {
      return runAgentTask(instruction)
    }
    if (!activePath) {
      pushChat('assistant', 'Open a resume file first.')
      return
    }
    if (!instruction.trim()) return
    setBusy(true)
    pushChat('user', instruction)
    const streamId = pushChat('assistant', 'Editing…', { streaming: true })
    try {
      assertRateLimit()
      const base = await readBaseResume()
      const ctx = await getApiContext()
      const openTrimmed = retrieveRelevantSections(content, instruction, MAX_RESUME_CHARS)
      const baseTrimmed = base
        ? retrieveRelevantSections(base, instruction, Math.floor(MAX_RESUME_CHARS / 2))
        : undefined
      const messages = [
        { role: 'system' as const, content: buildEditSystemPrompt() },
        {
          role: 'user' as const,
          content: buildEditUserPrompt({
            instruction,
            openFile: openTrimmed,
            selection: selection || undefined,
            baseResume: baseTrimmed,
          }),
        },
      ]
      updateChat(streamId, {
        attribution: `${ctx.provider} / ${ctx.model} · ~${estimateMessagesTokens(messages)} tok in`,
      })

      const sel = editorRef.current?.getSelection()
      if (sel) {
        selectionRangeRef.current = {
          startLineNumber: sel.startLineNumber,
          startColumn: sel.startColumn,
          endLineNumber: sel.endLineNumber,
          endColumn: sel.endColumn,
        }
      } else {
        selectionRangeRef.current = null
      }

      const result = await streamChat({
        ...ctx,
        capability: 'resume_edit',
        messages,
        onChunk: (_c, assembled) => {
          updateChat(streamId, {
            content: assembled.slice(-800) || 'Editing…',
            streaming: true,
          })
          setStreamPreview(assembled)
        },
      })
      const parsed = parseEditResponse(result.text)
      const attr = formatAttribution(result)
      updateChat(streamId, {
        content: parsed.note,
        streaming: false,
        attribution: attr,
        provider: result.provider,
        model: result.model,
      })

      const before =
        parsed.mode === 'selection' && selection ? selection : content
      const after = parsed.content
      const needsConfirm =
        confirmLargeEdits ||
        parsed.mode === 'full' ||
        isLargeEdit(before, after)

      const edit: PendingEdit = {
        id: streamId,
        title: parsed.mode === 'selection' ? 'AI selection edit' : 'AI full-file edit',
        before,
        after,
        mode: parsed.mode === 'selection' && selection ? 'selection' : 'file',
        note: parsed.note,
        selectionRange: selectionRangeRef.current || undefined,
      }

      if (needsConfirm) {
        setPendingEdit(edit)
        setStreamPreview('')
        setStatus(`Preview ready · ${attr}`)
      } else {
        await applyAcceptedEdit(edit)
        pushChat('assistant', `${parsed.note} (${attr})`)
      }
    } catch (err) {
      updateChat(streamId, {
        content: err instanceof Error ? err.message : String(err),
        streaming: false,
      })
    } finally {
      setBusy(false)
      setStreamBusy(false)
      setStreamPreview('')
    }
  }

  const exportPdf = async () => {
    if (!content.trim()) {
      setStatus('Nothing to export')
      return
    }
    const title = activeRel || 'resume'
    const html = markdownToPrintHtml(content, title)
    const defaultName = (activeRel || 'resume').replace(/\.md$/i, '') + '.pdf'
    const saved = await window.resumeStudio.exportPdf(html, defaultName)
    if (saved) {
      setStatus(`PDF saved: ${saved}`)
      await window.resumeStudio.showItemInFolder(saved)
    }
  }

  const enableWebResearch = async () => {
    await window.resumeStudio.setSettings({ allowWebResearch: true })
    setAllowWebResearch(true)
    setStatus('Web research enabled for this machine')
  }

  const runEvidenceResearch = async (refresh: boolean) => {
    if (!evidenceUrl.trim() && !evidencePasted.trim()) return
    setResearching(true)
    setEvidenceError('')
    try {
      const ctx = await window.resumeStudio.fetchJobContext({
        workspace,
        url: evidenceUrl.trim(),
        jobDescription: lensJd,
        pastedText: evidencePasted,
        topK: 10,
        refresh,
      })
      setEvidenceContext(ctx)
      setLensJd(ctx.jobText)
      setStatus(
        `Researched ${ctx.company || ctx.title || 'pasted JD'} · ${ctx.snippets.length} snippets${ctx.cached ? ' (cached)' : ''}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setEvidenceError(message)
      setEvidenceContext(null)
    } finally {
      setResearching(false)
    }
  }

  const runEvidenceTailor = async () => {
    const ctx = evidenceContext
    if (!ctx) return
    if (!content.trim()) {
      setEvidenceError('Open a resume file first (base-resume.md or a variant).')
      return
    }

    setBusy(true)
    setEvidenceError('')
    setGhostStreaming(true)
    setGhostText('')
    const chatId = pushChat('user', `Tailor with evidence for ${ctx.company || ctx.url}`)
    const streamId = pushChat('assistant', 'Reading evidence…', { streaming: true })

    try {
      assertRateLimit()
      const apiCtx = await getApiContext()
      const pinned = ctx.snippets.filter((s) => evidencePinned.includes(s.id))
      const rest = ctx.snippets.filter((s) => !evidencePinned.includes(s.id))
      const chosen = [...pinned, ...rest].slice(0, 10)

      const messages = [
        { role: 'system' as const, content: buildEvidenceSystemPrompt() },
        {
          role: 'user' as const,
          content: buildEvidenceUserPrompt({
            company: ctx.company,
            jobTitle: ctx.title,
            jobUrl: ctx.url,
            jobText: ctx.jobText,
            snippets: chosen,
            resume: retrieveRelevantSections(content, ctx.jobText, MAX_RESUME_CHARS),
            instruction: evidenceInstruction.trim() || undefined,
          }),
        },
      ]
      updateChat(streamId, {
        attribution: `${apiCtx.provider} / ${apiCtx.model} · ~${estimateMessagesTokens(messages)} tok in`,
      })

      const result = await streamChat({
        ...apiCtx,
        capability: 'resume_rewrite',
        messages,
        onChunk: (_c, assembled) => {
          const bullets = extractPartialBullets(assembled)
          if (bullets.length) setGhostText(bullets.join('\n'))
          updateChat(streamId, {
            content: bullets.length
              ? `Drafting ${bullets.length} bullet(s)…\n${bullets.join('\n')}`
              : 'Reading evidence…',
            streaming: true,
          })
        },
      })

      const parsed = parseEvidenceResponse(result.text)
      const attr = formatAttribution(result)
      setEvidenceSuggestions(parsed.suggestions)
      setEvidenceAtsFit(parsed.atsFit)
      setEvidenceNote(parsed.note)
      setGhostText(suggestionsToGhostText(parsed.suggestions))
      updateChat(streamId, {
        content: parsed.suggestions.length
          ? `${parsed.note} — ${parsed.suggestions.length} evidence-backed suggestions.`
          : `${parsed.note}\n\n${result.text.slice(0, 1200)}`,
        streaming: false,
        attribution: attr,
        provider: result.provider,
        model: result.model,
      })

      if (workspace) {
        void window.resumeStudio
          .recordAiAudit({
            workspace,
            action: 'evidence-tailor',
            provider: result.provider,
            model: result.model,
            jobUrl: ctx.url,
            targetFile: activeRel || '',
            evidence: chosen.map((s) => ({
              id: s.id,
              sourceUrl: s.sourceUrl,
              excerpt: s.text,
            })),
            promptSnapshot: messages.map((m) => `${m.role}: ${m.content}`).join('\n\n'),
          })
          .catch(() => undefined)
      }

      setStatus(`Evidence suggestions ready · ${attr}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setEvidenceError(message)
      updateChat(streamId, { content: message, streaming: false })
      updateChat(chatId, {})
    } finally {
      setBusy(false)
      setGhostStreaming(false)
    }
  }

  const previewEvidenceEdit = () => {
    const ctx = evidenceContext
    const accepted = evidenceSuggestions.filter((s) => s.accepted)
    if (!accepted.length) return

    const { content: next, applied, skipped } = applyEvidenceSuggestions(
      content,
      evidenceSuggestions,
    )
    if (!applied) {
      setEvidenceError(
        'None of the selected suggestions matched the current text. Re-run research after editing.',
      )
      return
    }

    const cites: DiffEvidence[] = []
    for (const s of accepted) {
      for (const id of s.evidence) {
        const snippet = ctx?.snippets.find((x) => x.id === id)
        if (snippet && !cites.some((c) => c.id === snippet.id)) {
          cites.push({
            id: snippet.id,
            sourceUrl: snippet.sourceUrl,
            sourceTitle: snippet.sourceTitle,
            excerpt: snippet.text,
          })
        }
      }
    }

    setPendingEvidence(cites)
    setPendingCommitMsg(
      `Tailor ${activeRel || 'resume'} for ${ctx?.company || 'target role'} (evidence-backed)`,
    )
    setPendingEdit({
      id: `evidence-${Date.now()}`,
      title: `Evidence-Backed Tailor — ${ctx?.company || 'job'}`,
      before: content,
      after: next,
      mode: 'file',
      note: `${applied} suggestion(s) applied${skipped.length ? `, ${skipped.length} skipped (text not found)` : ''}.`,
      meta: { evidence: '1' },
    })
  }

  const lensJobDescription = useMemo(() => {
    if (lensJd.trim()) return lensJd
    const { meta } = parseFrontmatter(content)
    const company = meta.company || ''
    const role = meta.role || ''
    if (company && role) {
      const hit = huntResults.find(
        (j) =>
          j.company.toLowerCase() === company.toLowerCase() &&
          j.title.toLowerCase() === role.toLowerCase(),
      )
      if (hit?.description) return hit.description
    }
    return ''
  }, [lensJd, content, huntResults])

  const paletteCommands = useMemo((): PaletteCommand[] => {
    const cmds: PaletteCommand[] = [
      {
        id: 'save',
        label: 'Save file',
        hint: 'Ctrl+S',
        group: 'command',
        run: () => void saveFile(),
      },
      {
        id: 'theme-dark',
        label: 'Theme: Dark',
        group: 'command',
        run: () => setTheme('dark'),
      },
      {
        id: 'theme-light',
        label: 'Theme: Light',
        group: 'command',
        run: () => setTheme('light'),
      },
      {
        id: 'theme-system',
        label: 'Theme: Match system',
        group: 'command',
        run: () => setTheme('system'),
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        hint: 'Ctrl+B',
        group: 'command',
        run: () => setSidebarOpen((v) => !v),
      },
      {
        id: 'toggle-inspector',
        label: 'Toggle assistant panel',
        hint: 'Ctrl+J',
        group: 'command',
        run: () => setInspectorOpen((v) => !v),
      },
      {
        id: 'show-outline',
        label: 'Show resume outline',
        hint: 'Ctrl+Shift+O',
        group: 'command',
        run: () => {
          setSidebarView('outline')
          setSidebarOpen(true)
        },
      },
      {
        id: 'export',
        label: 'Export PDF',
        group: 'command',
        run: () => void exportPdf(),
      },
      {
        id: 'apply-kit',
        label: 'Build Apply kit',
        group: 'command',
        run: () => void generateApplyKit(),
      },
      {
        id: 'interview',
        label: 'Generate interview prep',
        group: 'command',
        run: () => void generateInterviewPrep(),
      },
      {
        id: 'settings',
        label: 'Open Settings',
        group: 'command',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'lens-edit',
        label: 'Recruiter Lens: Edit mode',
        group: 'command',
        run: () => setLensMode('edit'),
      },
      {
        id: 'lens-ats',
        label: 'Recruiter Lens: ATS mode',
        group: 'command',
        run: () => setLensMode('ats'),
      },
      {
        id: 'lens-scan',
        label: 'Recruiter Lens: Recruiter scan',
        group: 'command',
        run: () => setLensMode('scan'),
      },
      {
        id: 'achievement',
        label: 'Open Achievement builder',
        hint: 'Ctrl+Shift+A',
        group: 'command',
        run: () => setAchievementOpen(true),
      },
      {
        id: 'git',
        label: 'Open Git panel',
        hint: 'Ctrl+Shift+G',
        group: 'command',
        run: () => {
          if (workspace) setGitOpen(true)
        },
      },
      {
        id: 'roles',
        label: 'Focus Role variants panel',
        group: 'command',
        run: () => {
          setInspectorView('roles')
          setInspectorOpen(true)
          setFocusRoles(true)
          window.setTimeout(() => setFocusRoles(false), 400)
        },
      },
      {
        id: 'evidence',
        label: 'Tailor with Evidence (job URL research)',
        hint: 'Ctrl+Shift+E',
        group: 'command',
        run: () => {
          setInspectorView('evidence')
          setInspectorOpen(true)
          setFocusEvidence(true)
          window.setTimeout(() => setFocusEvidence(false), 400)
        },
      },
      {
        id: 'goto-file',
        label: 'Go to file…',
        hint: 'Ctrl+P',
        group: 'command',
        run: () => {
          setPaletteMode('files')
          setPaletteOpen(true)
        },
      },
      {
        id: 'open-folder',
        label: 'Open folder…',
        group: 'command',
        run: () => void pickFolder(),
      },
    ]
    return cmds
  }, [workspace, content, activePath])

  const title = useMemo(() => activeRel || 'Resume Studio', [activeRel])

  const wordCount = useMemo(
    () => (content.trim() ? content.trim().split(/\s+/).length : 0),
    [content],
  )

  const lensScore = useMemo(() => {
    if (!content.trim() || !lensJobDescription.trim()) return null
    try {
      return analyzeRecruiterLens(content, lensJobDescription).keywords.score
    } catch {
      return null
    }
  }, [content, lensJobDescription])

  if (!workspace) {
    return (
      <div className="app-shell">
        <TopBar
          title="Resume Studio"
          onOpenFolder={pickFolder}
          onSave={() => undefined}
          onExport={() => undefined}
          onApplyKit={() => undefined}
          onInterviewPrep={() => undefined}
          onSettings={() => setSettingsOpen(true)}
          canSave={false}
          canExport={false}
          canApplyKit={false}
          canInterviewPrep={false}
        />
        {settingsOpen ? (
          <SettingsPane onClose={closeSettings} />
        ) : (
          <Welcome onOpenFolder={pickFolder} onSettings={() => setSettingsOpen(true)} />
        )}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TopBar
        title={title}
        onOpenFolder={pickFolder}
        onSave={() => void saveFile()}
        onExport={() => void exportPdf()}
        onApplyKit={() => void generateApplyKit()}
        onInterviewPrep={() => void generateInterviewPrep()}
        onSettings={() => setSettingsOpen(true)}
        onCommandPalette={() => {
          setPaletteMode('commands')
          setPaletteOpen(true)
        }}
        onGit={() => setGitOpen(true)}
        onAchievement={() => setAchievementOpen(true)}
        onEvidence={() => {
          setInspectorView('evidence')
          setInspectorOpen(true)
          setFocusEvidence(true)
          window.setTimeout(() => setFocusEvidence(false), 400)
        }}
        canSave={Boolean(activePath)}
        canExport={Boolean(content.trim())}
        canApplyKit={Boolean(workspace && content.trim())}
        canInterviewPrep={Boolean(workspace && content.trim())}
        busy={busy}
        dirty={dirty}
        lastSavedAt={lastSavedAt}
        gitSummary={gitSummary}
      />
      {settingsOpen ? <SettingsPane onClose={closeSettings} /> : null}
      <div
        className={`main-panes ${sidebarOpen ? '' : 'sidebar-collapsed'} ${
          inspectorOpen ? '' : 'inspector-collapsed'
        }`}
        style={
          {
            '--sidebar-width': `${sidebarWidth}px`,
            '--inspector-width': `${inspectorWidth}px`,
            display: settingsOpen ? 'none' : undefined,
          } as React.CSSProperties
        }
      >
        <ActivityRail
          ariaLabel="Sidebar views"
          items={SIDEBAR_RAIL_ITEMS}
          active={sidebarOpen ? sidebarView : null}
          onSelect={(id) => {
            if (sidebarOpen && sidebarView === id) setSidebarOpen(false)
            else {
              setSidebarView(id)
              setSidebarOpen(true)
            }
          }}
          footer={
            <IconButton
              icon={PanelLeftClose}
              label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              shortcut="Ctrl+B"
              onClick={() => setSidebarOpen((v) => !v)}
              placement="top"
            />
          }
        />
        <Explorer
          tree={tree}
          activePath={activePath}
          onOpen={openFile}
          workspace={workspace}
          view={sidebarView}
          content={content}
          activeLine={cursorPos.line}
          onJumpToLine={(line) => {
            const ed = editorRef.current
            if (!ed) return
            ed.revealLineNearTop(line)
            ed.setPosition({ lineNumber: line, column: 1 })
            ed.focus()
          }}
          onRefresh={() => void refreshTree(workspace)}
          onOpenFolder={pickFolder}
        />
        <div
          className="pane-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startResize('sidebar')}
        />
        <EditorPane
          content={content}
          relativePath={activeRel}
          tabs={openDocs.map((d) => ({
            path: d.path,
            relativePath: d.relativePath,
            dirty: d.dirty,
          }))}
          activePath={activePath}
          onSelectTab={switchTab}
          onCloseTab={closeTab}
          jobDescription={lensJobDescription}
          lensMode={lensMode}
          ghostText={ghostText}
          ghostLabel={`Evidence-Backed Tailor${evidenceContext ? ` · ${evidenceContext.company}` : ''}`}
          ghostStreaming={ghostStreaming}
          theme={resolveTheme(theme)}
          aiBusy={busy || streamBusy}
          onAiAction={(instruction) => {
            setInspectorView('edit')
            setInspectorOpen(true)
            void editWithChat(instruction)
          }}
          onGhostAccept={() => {
            if (!ghostText) return
            insertAtCursor(ghostText)
            setGhostText('')
          }}
          onGhostDismiss={() => setGhostText('')}
          onLensModeChange={setLensMode}
          onChange={(v) => {
            setContent(v)
            setDirty(true)
          }}
          onSelectionChange={(text) => {
            setSelection(text)
            const sel = editorRef.current?.getSelection()
            if (sel && !sel.isEmpty()) {
              selectionRangeRef.current = {
                startLineNumber: sel.startLineNumber,
                startColumn: sel.startColumn,
                endLineNumber: sel.endLineNumber,
                endColumn: sel.endColumn,
              }
            }
          }}
          onMount={(ed) => {
            editorRef.current = ed
            ed.onDidChangeCursorPosition((e) => {
              setCursorPos({ line: e.position.lineNumber, column: e.position.column })
            })
          }}
        />
        <div
          className="pane-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector"
          onPointerDown={startResize('inspector')}
        />
        <SidePanel
          messages={chat}
          busy={busy || streamBusy}
          applications={applications}
          huntResults={huntResults}
          huntQuery={huntQuery}
          huntSelectedIds={huntSelectedIds}
          workspace={workspace}
          tree={tree}
          jobDescription={lensJobDescription}
          onHuntQueryChange={setHuntQuery}
          onHuntSearch={() => void runJobHunt()}
          onHuntToggle={(id) => {
            setHuntSelectedIds((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }}
          onHuntSelectTop={(n) => {
            const ids = huntResults
              .filter((j) => !j.alreadyTracked)
              .slice(0, n)
              .map((j) => j.id)
            setHuntSelectedIds(new Set(ids))
          }}
          onHuntClearSelection={() => setHuntSelectedIds(new Set())}
          onHuntPrepare={() => void prepareSelectedJobs()}
          onOpenPreferences={() => void openPreferences()}
          onTailor={tailorFromJd}
          onEdit={editWithChat}
          onRefreshApps={() => void refreshApplications()}
          onSetStatus={async (id, status, note) => {
            if (!workspace) return
            setBusy(true)
            try {
              const rows = await window.resumeStudio.setApplicationStatus({
                workspace,
                id,
                status,
                note,
              })
              setApplications(rows)
              setStatus(`Updated application → ${status}`)
            } catch (err) {
              pushChat('assistant', err instanceof Error ? err.message : String(err))
            } finally {
              setBusy(false)
            }
          }}
          onOpenJob={(url) => {
            void window.resumeStudio.openExternal(url).catch((err) => {
              pushChat('assistant', err instanceof Error ? err.message : String(err))
            })
          }}
          onOpenKit={(notes) => {
            if (!workspace) return
            void window.resumeStudio.openApplicationKit(workspace, notes).catch((err) => {
              pushChat('assistant', err instanceof Error ? err.message : String(err))
            })
          }}
          onInterviewPrepRow={(row) => void interviewPrepFromTrackerRow(row)}
          onOpenAbsolute={openAbsolute}
          onTreeRefresh={async () => {
            if (workspace) await refreshTree(workspace)
          }}
          onFeedback={(id, rating) => {
            const msg = chat.find((m) => m.id === id)
            updateChat(id, { feedback: rating })
            if (!workspace || !msg) return
            void window.resumeStudio
              .submitAiFeedback({
                workspace,
                rating,
                provider: msg.provider,
                model: msg.model,
                snippet: msg.content,
              })
              .then(() => setStatus(`Feedback saved (${rating})`))
              .catch((err) =>
                pushChat('assistant', err instanceof Error ? err.message : String(err)),
              )
          }}
          evidenceSlot={
            <EvidencePanel
              url={evidenceUrl}
              pastedText={evidencePasted}
              instruction={evidenceInstruction}
              busy={busy}
              researching={researching}
              context={evidenceContext}
              suggestions={evidenceSuggestions}
              atsFit={evidenceAtsFit}
              note={evidenceNote}
              pinnedIds={evidencePinned}
              error={evidenceError}
              allowWebResearch={allowWebResearch}
              onUrlChange={setEvidenceUrl}
              onPastedTextChange={setEvidencePasted}
              onInstructionChange={setEvidenceInstruction}
              onResearch={(refresh) => void runEvidenceResearch(refresh)}
              onTailor={() => void runEvidenceTailor()}
              onToggleSuggestion={(id) =>
                setEvidenceSuggestions((prev) =>
                  prev.map((s) => (s.id === id ? { ...s, accepted: !s.accepted } : s)),
                )
              }
              onTogglePin={(snippetId) =>
                setEvidencePinned((prev) =>
                  prev.includes(snippetId)
                    ? prev.filter((x) => x !== snippetId)
                    : [...prev, snippetId],
                )
              }
              onOpenSource={(sourceUrl) => {
                if (!sourceUrl) return
                void window.resumeStudio.openExternal(sourceUrl).catch(() => undefined)
              }}
              onPreview={previewEvidenceEdit}
              onEnableResearch={() => void enableWebResearch()}
              onRefineSuggestion={(id) => {
                const s = evidenceSuggestions.find((x) => x.id === id)
                if (!s) return
                setEvidenceInstruction(`Refine this bullet: ${s.text}`)
                setStatus('Refine instruction loaded — adjust it, then Tailor with Evidence again')
              }}
            />
          }
          focusTracker={focusTracker}
          focusRoles={focusRoles}
          focusEvidence={focusEvidence}
          mode={inspectorView}
          onModeChange={(m) => {
            setInspectorView(m)
            setInspectorOpen(true)
          }}
        />
        <ActivityRail
          side="right"
          ariaLabel="Assistant panels"
          items={INSPECTOR_RAIL_ITEMS}
          active={inspectorOpen ? inspectorView : null}
          onSelect={(id) => {
            if (inspectorOpen && inspectorView === id) setInspectorOpen(false)
            else {
              setInspectorView(id)
              setInspectorOpen(true)
            }
          }}
          footer={
            <IconButton
              icon={PanelRightClose}
              label={inspectorOpen ? 'Collapse panel' : 'Expand panel'}
              shortcut="Ctrl+J"
              onClick={() => setInspectorOpen((v) => !v)}
              placement="top"
            />
          }
        />
      </div>
      <StatusBar
        status={status}
        busy={busy || streamBusy}
        dirty={dirty}
        hasFile={Boolean(activePath)}
        gitSummary={gitSummary}
        provider={provider}
        model={model}
        agentMode={agentMode && supportsAgentMode(provider)}
        lensScore={lensScore}
        cursorLine={cursorPos.line}
        cursorColumn={cursorPos.column}
        wordCount={wordCount}
        theme={theme}
        onToggleTheme={cycleTheme}
        onOpenGit={() => setGitOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        workspace={workspace}
        tree={tree}
        content={content}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onOpenFile={openFile}
        onGoToLine={goToLine}
      />
      <AchievementBuilder
        open={achievementOpen}
        seedText={selection}
        onClose={() => setAchievementOpen(false)}
        onInsert={insertAtCursor}
      />
      {workspace ? (
        <GitPanel
          open={gitOpen}
          workspace={workspace}
          onClose={() => setGitOpen(false)}
          onStatus={setGitSummary}
        />
      ) : null}
      <DiffPreviewModal
        open={Boolean(pendingEdit)}
        title={pendingEdit?.title || 'AI edit preview'}
        before={pendingEdit?.before || ''}
        after={pendingEdit?.after || ''}
        note={pendingEdit?.note}
        attribution={
          pendingEdit
            ? chat.find((m) => m.id === pendingEdit.id)?.attribution
            : undefined
        }
        streaming={streamBusy && Boolean(pendingEdit) && !pendingEdit?.after}
        streamPreview={streamPreview}
        evidence={pendingEvidence}
        commitSuggestion={pendingCommitMsg}
        canCommit={Boolean(workspace) && gitSummary !== ''}
        onOpenSource={(sourceUrl) => {
          void window.resumeStudio.openExternal(sourceUrl).catch(() => undefined)
        }}
        onReject={() => {
          setPendingEdit(null)
          setPendingEvidence([])
          setStreamPreview('')
          setStatus('AI edit rejected')
        }}
        onAccept={(opts) => {
          const edit = pendingEdit
          if (!edit || streamBusy) return
          void (async () => {
            try {
              await applyAcceptedEdit(edit)
              if (
                edit.mode === 'create-file' &&
                edit.meta?.buildKit === '1' &&
                edit.createRel
              ) {
                await buildAndWriteApplyKit(edit.after, {
                  company: edit.meta.company || '',
                  role: edit.meta.role || '',
                  sourceRel: edit.createRel,
                  focusTracker: edit.meta.focusTracker === '1',
                })
              }

              if (edit.meta?.evidence === '1') {
                setEvidenceSuggestions([])
                setGhostText('')
              }

              if (opts?.commit && workspace) {
                const targetPath = edit.createPath || activePath
                if (targetPath && edit.mode !== 'create-file') {
                  await window.resumeStudio.writeFile(targetPath, edit.after)
                  setDirty(false)
                }
                const result = await window.resumeStudio.gitCommit(
                  workspace,
                  opts.message || edit.title,
                )
                const s = await window.resumeStudio.gitStatus(workspace)
                setGitSummary(s.isRepo ? `${s.branch || 'git'}: ${s.summary}` : '')
                pushChat('assistant', `Applied and committed ${result.commit}`)
                setStatus(`Committed ${result.commit}`)
              } else {
                pushChat('assistant', `Accepted: ${edit.title}`)
              }
            } catch (err) {
              pushChat('assistant', err instanceof Error ? err.message : String(err))
            } finally {
              setPendingEdit(null)
              setPendingEvidence([])
              setStreamPreview('')
            }
          })()
        }}
      />
    </div>
  )
}
