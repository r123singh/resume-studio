import type { TreeNode } from '../../electron/preload'

type Props = {
  tree: TreeNode[]
  activePath: string | null
  onOpen: (node: TreeNode) => void
  workspace: string
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
        <div className="tree-label dir" style={{ paddingLeft: 10 + depth * 12 }}>
          {node.name}/
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
      style={{ paddingLeft: 10 + depth * 12 }}
      onClick={() => onOpen(node)}
      title={node.relativePath}
    >
      {node.name}
    </button>
  )
}

export function Explorer({ tree, activePath, onOpen, workspace }: Props) {
  const short = workspace.split(/[/\\]/).filter(Boolean).slice(-2).join('/')
  return (
    <aside className="explorer">
      <div className="pane-header">Explorer</div>
      <div className="workspace-name" title={workspace}>
        {short}
      </div>
      <div className="tree">
        {tree.map((node) => (
          <NodeRow key={node.path} node={node} depth={0} activePath={activePath} onOpen={onOpen} />
        ))}
      </div>
    </aside>
  )
}
