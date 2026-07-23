import './styles/app.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { TopBar } from './components/TopBar'
import { Explorer } from './components/Explorer'
import { EditorPane } from './components/EditorPane'
import { ChatPanel } from './components/ChatPanel'
import { SettingsModal } from './components/SettingsModal'
import { Welcome } from './components/Welcome'
import type { TreeNode } from '../electron/preload'
import { markdownToPrintHtml } from './lib/pdf'
import { resumeFileName } from './lib/slug'
import {
  buildEditSystemPrompt,
  buildEditUserPrompt,
  buildTailorSystemPrompt,
  buildTailorUserPrompt,
  parseEditResponse,
  stripCodeFences,
} from './lib/ai/prompts'
import { completeChat, type ProviderId } from './lib/ai/providers'

type ChatItem = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export default function App() {
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [activeRel, setActiveRel] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [chat, setChat] = useState<ChatItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Open a workspace, then paste a job description in Tailor mode — or ask me to refine the open resume.',
    },
  ])
  const [selection, setSelection] = useState('')
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)

  const refreshTree = useCallback(async (root: string) => {
    const nodes = await window.resumeStudio.listWorkspace(root)
    setTree(nodes)
  }, [])

  const openWorkspace = useCallback(
    async (root: string) => {
      setWorkspace(root)
      await refreshTree(root)
      setStatus(`Workspace: ${root}`)
      await window.resumeStudio.setSettings({ lastWorkspace: root })
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
    })()
  }, [openWorkspace])

  const pickFolder = async () => {
    const root = await window.resumeStudio.openFolder()
    if (root) await openWorkspace(root)
  }

  const openFile = async (node: TreeNode) => {
    if (node.type !== 'file') return
    if (dirty && activePath) {
      const ok = window.confirm('Save current file before switching?')
      if (ok) await saveFile()
    }
    const text = await window.resumeStudio.readFile(node.path)
    setActivePath(node.path)
    setActiveRel(node.relativePath)
    setContent(text)
    setDirty(false)
    setStatus(`Opened ${node.relativePath}`)
  }

  const saveFile = async () => {
    if (!activePath) return
    await window.resumeStudio.writeFile(activePath, content)
    setDirty(false)
    setStatus(`Saved ${activeRel}`)
    if (workspace) await refreshTree(workspace)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveFile()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activePath, content, activeRel, workspace])

  const getApiContext = async () => {
    const secrets = await window.resumeStudio.getSecrets()
    const key =
      secrets.provider === 'openai'
        ? secrets.openaiKey
        : secrets.provider === 'anthropic'
          ? secrets.anthropicKey
          : secrets.geminiKey
    return {
      provider: secrets.provider as ProviderId,
      model: secrets.model,
      apiKey: key,
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

  const pushChat = (role: ChatItem['role'], contentText: string) => {
    setChat((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, role, content: contentText },
    ])
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
    if (!input.company.trim() || !input.role.trim() || !input.jobDescription.trim()) {
      pushChat('assistant', 'Company, role, and job description are required.')
      return
    }

    setBusy(true)
    pushChat(
      'user',
      `Tailor resume for ${input.role} at ${input.company}`,
    )
    try {
      const base = await readBaseResume()
      if (!base.trim()) {
        throw new Error('base-resume.md is empty. Add your master resume first.')
      }
      const ctx = await getApiContext()
      const today = new Date().toISOString().slice(0, 10)
      const raw = await completeChat({
        ...ctx,
        messages: [
          { role: 'system', content: buildTailorSystemPrompt() },
          {
            role: 'user',
            content: buildTailorUserPrompt({
              baseResume: base,
              company: input.company,
              role: input.role,
              location: input.location,
              jobUrl: input.jobUrl,
              jobDescription: input.jobDescription,
              today,
            }),
          },
        ],
      })
      const markdown = stripCodeFences(raw)
      const fileName = resumeFileName(input.company, input.role)
      const resumesDir = await window.resumeStudio.ensureResumesDir(workspace)
      const outPath = await window.resumeStudio.pathJoin(resumesDir, fileName)
      await window.resumeStudio.writeFile(outPath, markdown)
      await refreshTree(workspace)
      setActivePath(outPath)
      setActiveRel(`resumes/${fileName}`)
      setContent(markdown)
      setDirty(false)
      pushChat(
        'assistant',
        `Created resumes/${fileName}. Opened in the editor — tweak via Edit chat if needed.`,
      )
      setStatus(`Tailored ${fileName}`)
    } catch (err) {
      pushChat('assistant', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const editWithChat = async (instruction: string) => {
    if (!activePath) {
      pushChat('assistant', 'Open a resume file first.')
      return
    }
    if (!instruction.trim()) return
    setBusy(true)
    pushChat('user', instruction)
    try {
      const base = await readBaseResume()
      const ctx = await getApiContext()
      const raw = await completeChat({
        ...ctx,
        messages: [
          { role: 'system', content: buildEditSystemPrompt() },
          {
            role: 'user',
            content: buildEditUserPrompt({
              instruction,
              openFile: content,
              selection: selection || undefined,
              baseResume: base || undefined,
            }),
          },
        ],
      })
      const parsed = parseEditResponse(raw)
      if (parsed.mode === 'selection' && selection && editorRef.current) {
        const ed = editorRef.current
        const sel = ed.getSelection()
        if (sel) {
          ed.executeEdits('ai-edit', [
            {
              range: sel,
              text: parsed.content,
              forceMoveMarkers: true,
            },
          ])
          const next = ed.getValue()
          setContent(next)
          setDirty(true)
        } else {
          setContent(parsed.content)
          setDirty(true)
        }
      } else {
        setContent(parsed.content)
        setDirty(true)
        editorRef.current?.setValue(parsed.content)
      }
      pushChat('assistant', parsed.note)
      setStatus('AI edit applied (unsaved)')
    } catch (err) {
      pushChat('assistant', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
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

  const title = useMemo(() => {
    if (!activeRel) return 'Resume Studio'
    return dirty ? `${activeRel} •` : activeRel
  }, [activeRel, dirty])

  if (!workspace) {
    return (
      <div className="app-shell">
        <TopBar
          title="Resume Studio"
          onOpenFolder={pickFolder}
          onSave={() => undefined}
          onExport={() => undefined}
          onSettings={() => setSettingsOpen(true)}
          canSave={false}
          canExport={false}
        />
        <Welcome onOpenFolder={pickFolder} onSettings={() => setSettingsOpen(true)} />
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
        onSettings={() => setSettingsOpen(true)}
        canSave={Boolean(activePath)}
        canExport={Boolean(content.trim())}
        status={status}
        busy={busy}
      />
      <div className="main-panes">
        <Explorer tree={tree} activePath={activePath} onOpen={openFile} workspace={workspace} />
        <EditorPane
          content={content}
          relativePath={activeRel}
          onChange={(v) => {
            setContent(v)
            setDirty(true)
          }}
          onSelectionChange={setSelection}
          onMount={(ed) => {
            editorRef.current = ed
          }}
        />
        <ChatPanel
          messages={chat}
          busy={busy}
          onTailor={tailorFromJd}
          onEdit={editWithChat}
        />
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
