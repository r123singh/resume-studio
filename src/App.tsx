import './styles/app.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { TopBar } from './components/TopBar'
import { Explorer } from './components/Explorer'
import { EditorPane } from './components/EditorPane'
import { SidePanel } from './components/SidePanel'
import type { ApplicationRow, JobListing } from './components/SidePanel'
import { SettingsModal } from './components/SettingsModal'
import { Welcome } from './components/Welcome'
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
        'Open a workspace, paste a JD in Tailor mode, then click Apply kit for PDF + cover letter + form snippets + checklist.',
    },
  ])
  const [selection, setSelection] = useState('')
  const [applications, setApplications] = useState<ApplicationRow[]>([])
  const [focusTracker, setFocusTracker] = useState(false)
  const [huntQuery, setHuntQuery] = useState('senior product manager AI')
  const [huntResults, setHuntResults] = useState<JobListing[]>([])
  const [huntSelectedIds, setHuntSelectedIds] = useState<Set<string>>(new Set())
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)

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

  const pushChat = (role: ChatItem['role'], contentText: string) => {
    setChat((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, role, content: contentText },
    ])
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

    pushChat('user', `Tailor resume for ${input.role} at ${input.company}`)
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
    pushChat('assistant', `Created resumes/${fileName}`)
    setStatus(`Tailored ${fileName}`)
    if (opts?.buildKit !== false) {
      await buildAndWriteApplyKit(markdown, {
        company: input.company,
        role: input.role,
        sourceRel: `resumes/${fileName}`,
        focusTracker: opts?.focusTracker,
      })
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
    setActivePath(prefsPath)
    setActiveRel('job-preferences.md')
    setContent(text)
    setDirty(false)
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
      setActivePath(outPath)
      setActiveRel(`interview-prep/${fileName}`)
      setContent(markdown)
      setDirty(false)
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
          onApplyKit={() => undefined}
          onInterviewPrep={() => undefined}
          onSettings={() => setSettingsOpen(true)}
          canSave={false}
          canExport={false}
          canApplyKit={false}
          canInterviewPrep={false}
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
        onApplyKit={() => void generateApplyKit()}
        onInterviewPrep={() => void generateInterviewPrep()}
        onSettings={() => setSettingsOpen(true)}
        canSave={Boolean(activePath)}
        canExport={Boolean(content.trim())}
        canApplyKit={Boolean(workspace && content.trim())}
        canInterviewPrep={Boolean(workspace && content.trim())}
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
        <SidePanel
          messages={chat}
          busy={busy}
          applications={applications}
          huntResults={huntResults}
          huntQuery={huntQuery}
          huntSelectedIds={huntSelectedIds}
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
          focusTracker={focusTracker}
        />
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
