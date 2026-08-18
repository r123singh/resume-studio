import { useCallback, useEffect, useState } from 'react'
import {
  compareVariantContent,
  DEFAULT_ROLE_VARIANTS,
  seedVariantFromBase,
  type VariantDiff,
} from '../lib/role-variants'
import { findTreeFile } from '../lib/markdown-nav'
import type { TreeNode } from '../../electron/preload'

type Props = {
  workspace: string
  tree: TreeNode[]
  jobDescription: string
  busy: boolean
  onOpenPath: (absolutePath: string, relativePath: string) => void | Promise<void>
  onTreeRefresh: () => void | Promise<void>
}

export function RoleSwitcher({
  workspace,
  tree,
  jobDescription,
  busy,
  onOpenPath,
  onTreeRefresh,
}: Props) {
  const [activeId, setActiveId] = useState<string>('product')
  const [diff, setDiff] = useState<VariantDiff | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const loadDiff = useCallback(async () => {
    const variant = DEFAULT_ROLE_VARIANTS.find((v) => v.id === activeId)
    if (!variant) return
    setLoading(true)
    setMessage('')
    try {
      const basePath = await window.resumeStudio.pathJoin(workspace, 'base-resume.md')
      const variantPath = await window.resumeStudio.pathJoin(workspace, variant.relativePath)
      let baseMd = ''
      let variantMd = ''
      try {
        baseMd = await window.resumeStudio.readFile(basePath)
      } catch {
        baseMd = ''
      }
      try {
        variantMd = await window.resumeStudio.readFile(variantPath)
      } catch {
        variantMd = ''
      }
      if (!variantMd) {
        setDiff(null)
        setMessage(`${variant.label} variant not created yet.`)
        return
      }
      setDiff(compareVariantContent(baseMd, variantMd, jobDescription))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspace, activeId, jobDescription])

  useEffect(() => {
    void loadDiff()
  }, [loadDiff])

  const openOrCreate = async () => {
    const variant = DEFAULT_ROLE_VARIANTS.find((v) => v.id === activeId)
    if (!variant) return
    setLoading(true)
    setMessage('')
    try {
      const basePath = await window.resumeStudio.pathJoin(workspace, 'base-resume.md')
      const variantPath = await window.resumeStudio.pathJoin(workspace, variant.relativePath)
      const existing = findTreeFile(tree, (n) => n.relativePath === variant.relativePath)
      if (!existing) {
        let baseMd = ''
        try {
          baseMd = await window.resumeStudio.readFile(basePath)
        } catch {
          throw new Error('base-resume.md missing — create it first.')
        }
        await window.resumeStudio.writeFile(variantPath, seedVariantFromBase(baseMd, variant.label))
        await onTreeRefresh()
        setMessage(`Created ${variant.relativePath}`)
      }
      await onOpenPath(variantPath, variant.relativePath)
      await loadDiff()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const openBase = async () => {
    const p = await window.resumeStudio.pathJoin(workspace, 'base-resume.md')
    await onOpenPath(p, 'base-resume.md')
  }

  return (
    <div className="role-switcher">
      <p className="muted role-switcher-intro">
        Role variants inherit shared base content. Emphasize different bullets, skills, and summary
        per target.
      </p>
      <div className="role-timeline" role="tablist" aria-label="Role variants">
        {DEFAULT_ROLE_VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={activeId === v.id}
            className={`role-chip ${activeId === v.id ? 'active' : ''}`}
            onClick={() => setActiveId(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="role-actions">
        <button type="button" className="btn ghost" disabled={busy || loading} onClick={() => void openBase()}>
          Open base
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || loading}
          onClick={() => void openOrCreate()}
        >
          {loading ? 'Working…' : 'Open / create variant'}
        </button>
      </div>

      {message ? <p className="settings-msg">{message}</p> : null}

      {diff ? (
        <div className="role-diff">
          <div className="lens-score-row">
            <div>
              <span className="lens-score-label">Strength vs JD</span>
              <span className="lens-score-value">{diff.keywordScore}%</span>
            </div>
            <div className="lens-score-meta">{diff.sharedLines} shared lines with base</div>
          </div>

          {diff.variantOnly.length ? (
            <div className="lens-block">
              <div className="lens-block-title">Variant-specific</div>
              <ul className="role-line-list">
                {diff.variantOnly.map((l) => (
                  <li key={l}>{l.slice(0, 120)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {diff.missing.length ? (
            <div className="lens-block">
              <div className="lens-block-title">Missing JD keywords</div>
              <div className="lens-chips">
                {diff.missing.slice(0, 8).map((k) => (
                  <span key={k} className="lens-chip missing">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {diff.matched.length ? (
            <div className="lens-block">
              <div className="lens-block-title">Matched</div>
              <div className="lens-chips">
                {diff.matched.slice(0, 8).map((k) => (
                  <span key={k} className="lens-chip ok">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
