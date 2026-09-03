import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Heading,
  Image as ImageIcon,
  ListTree,
  RefreshCw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TreeNode } from '../../electron/preload'
import { listMarkdownSections } from '../lib/markdown-nav'
import { IconButton } from './ui/IconButton'
import { EmptyState } from './ui/EmptyState'

export type SidebarView = 'files' | 'outline'

type Props = {
  tree: TreeNode[]
  activePath: string | null
  onOpen: (node: TreeNode) => void
  workspace: string
  view: SidebarView
  content: string
  activeLine: number
  onJumpToLine: (line: number) => void
  onRefresh: () => void
  onOpenFolder: () => void
}

/** Pick a file-type icon from the extension, like an IDE explorer. */
function fileIconFor(name: string): LucideIcon {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['md', 'markdown', 'txt', 'rtf', 'pdf', 'doc', 'docx'].includes(ext)) return FileText
  if (
    ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'html', 'yml', 'yaml', 'sh', 'py'].includes(
      ext,
    )
  )
    return FileCode
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return ImageIcon
  return File
}

function NodeRow({
  node,
  depth,
  activePath,
  onOpen,
  expanded,
  onToggle,
}: {
  node: TreeNode
  depth: number
  activePath: string | null
  onOpen: (node: TreeNode) => void
  expanded: Set<string>
  onToggle: (path: string) => void
}) {
  if (node.type === 'directory') {
    const open = expanded.has(node.path)
    const Chevron = open ? ChevronDown : ChevronRight
    const FolderIcon = open ? FolderOpen : Folder
    return (
      <div className="tree-dir">
        <button
          type="button"
          className="tree-label dir"
          style={{ paddingLeft: 8 + depth * 8 }}
          onClick={() => onToggle(node.path)}
          title={node.relativePath}
        >
          <Chevron size={16} strokeWidth={1.5} className="tree-chevron" />
          <FolderIcon size={16} strokeWidth={1.5} />
          <span className="tree-label-text">{node.name}</span>
        </button>
        {open
          ? (node.children || []).map((child) => (
              <NodeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onOpen={onOpen}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))
          : null}
      </div>
    )
  }

  const active = node.path === activePath
  const Icon = fileIconFor(node.name)
  return (
    <button
      type="button"
      className={`tree-label file ${active ? 'active' : ''}`}
      style={{ paddingLeft: 8 + depth * 8 + 22 }}
      onClick={() => onOpen(node)}
      title={node.relativePath}
    >
      <Icon size={16} strokeWidth={1.5} />
      <span className="tree-label-text">{node.name}</span>
    </button>
  )
}

/**
 * Left sidebar. `files` is the workspace tree; `outline` turns the open
 * markdown document's headings into a resume section navigator.
 */
export function Explorer({
  tree,
  activePath,
  onOpen,
  workspace,
  view,
  content,
  activeLine,
  onJumpToLine,
  onRefresh,
  onOpenFolder,
}: Props) {
  const short = workspace.split(/[/\\]/).filter(Boolean).slice(-1)[0] || workspace
  const sections = useMemo(() => listMarkdownSections(content), [content])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleDir = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  // Expand top-level folders on first load so the workspace isn't a wall of
  // collapsed rows. Only seeds when the user hasn't toggled anything yet.
  useEffect(() => {
    setExpanded((prev) => {
      if (prev.size) return prev
      const next = new Set<string>()
      for (const node of tree) if (node.type === 'directory') next.add(node.path)
      return next
    })
  }, [tree])

  // Reveal the active file by expanding every folder that contains it.
  useEffect(() => {
    if (!activePath) return
    setExpanded((prev) => {
      const next = new Set(prev)
      const addAncestors = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.type !== 'directory' || !node.children) continue
          if (activePath.length > node.path.length && activePath.startsWith(node.path)) {
            next.add(node.path)
            addAncestors(node.children)
          }
        }
      }
      addAncestors(tree)
      return next
    })
  }, [activePath, tree])

  // The active section is the last heading at or above the cursor.
  const activeIndex = useMemo(() => {
    let idx = -1
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].line <= activeLine) idx = i
      else break
    }
    return idx
  }, [sections, activeLine])

  return (
    <aside className="explorer">
      <div className="pane-header">
        <span>{view === 'files' ? 'Explorer' : 'Outline'}</span>
        <span className="pane-header-actions">
          {view === 'files' ? (
            <>
              <IconButton icon={RefreshCw} label="Refresh tree" onClick={onRefresh} size={13} />
              <IconButton
                icon={FolderOpen}
                label="Open another folder"
                onClick={onOpenFolder}
                size={13}
              />
            </>
          ) : null}
        </span>
      </div>

      {view === 'files' ? (
        <>
          <div className="workspace-name" title={workspace}>
            <FolderOpen size={13} strokeWidth={1.75} />
            <span className="tree-label-text">{short}</span>
          </div>
          <div className="tree pane-scroll">
            {tree.length ? (
              tree.map((node) => (
                <NodeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  activePath={activePath}
                  onOpen={onOpen}
                  expanded={expanded}
                  onToggle={toggleDir}
                />
              ))
            ) : (
              <EmptyState
                icon={ListTree}
                title="No documents yet"
                description="Add a markdown resume to this folder to get started."
                compact
              />
            )}
          </div>
        </>
      ) : (
        <div className="pane-scroll">
          {sections.length ? (
            <div className="outline-list">
              {sections.map((s, i) => (
                <button
                  key={`${s.line}-${s.title}`}
                  type="button"
                  className={`outline-item level-${Math.min(s.level, 3)} ${
                    i === activeIndex ? 'active' : ''
                  }`}
                  onClick={() => onJumpToLine(s.line)}
                  title={`Jump to line ${s.line}`}
                >
                  {s.level === 1 ? <Heading size={13} strokeWidth={1.75} /> : null}
                  <span className="outline-text">{s.title}</span>
                  <span className="outline-line">{s.line}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Heading}
              title="No sections"
              description="Add markdown headings such as ## Experience to build an outline."
              compact
            />
          )}
        </div>
      )}
    </aside>
  )
}
