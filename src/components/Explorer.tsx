import { useMemo } from 'react'
import { FileText, FolderOpen, Heading, ListTree, RefreshCw } from 'lucide-react'
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

function NodeRow({
  node,
  depth,
  activePath,
  onOpen,
}: {
  node: TreeNode
  depth: number
  activePath: string | null
  onOpen: (node: TreeNode) => void
}) {
  const active = node.path === activePath

  if (node.type === 'directory') {
    return (
      <div className="tree-dir">
        <div className="tree-label dir" style={{ paddingLeft: 8 + depth * 10 }}>
          <span className="tree-label-text">{node.name}</span>
        </div>
        {(node.children || []).map((child) => (
          <NodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            activePath={activePath}
            onOpen={onOpen}
          />
        ))}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`tree-label file ${active ? 'active' : ''}`}
      style={{ paddingLeft: 8 + depth * 10 }}
      onClick={() => onOpen(node)}
      title={node.relativePath}
    >
      <FileText size={14} strokeWidth={1.75} />
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
