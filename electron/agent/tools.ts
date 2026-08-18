import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { searchWorkspace } from '../workspace-search'
import { fetchJobContext } from '../job-research'
import type { AgentToolEvent, EditProposal } from './types'

export type ToolContextArgs = {
  workspace: string | null
  activeRelativePath: string | null
  allowWebResearch: boolean
  onToolEvent: (event: AgentToolEvent) => void
  proposals: EditProposal[]
}

const MAX_READ_CHARS = 40_000

/** Reject path traversal and absolute paths escaping the workspace. */
function resolveInWorkspace(workspace: string, relativePath: string): string {
  const target = path.resolve(workspace, relativePath)
  const root = path.resolve(workspace)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the workspace: ${relativePath}`)
  }
  return target
}

function requireWorkspace(ctx: ToolContextArgs): string {
  if (!ctx.workspace) throw new Error('No workspace is open.')
  return ctx.workspace
}

/**
 * Resume-domain tools for the agent.
 *
 * Deliberately read-only except for `propose_edit`, which records a proposal
 * instead of writing. Every mutation still flows through the renderer's diff
 * confirmation, so the agent can plan freely but cannot silently rewrite a
 * resume.
 */
export async function buildResumeTools(ctx: ToolContextArgs) {
  const { tool } = await import('@strands-agents/sdk')

  const track = async <T>(
    name: string,
    input: Record<string, unknown>,
    run: () => Promise<T>,
    describe: (result: T) => string,
  ): Promise<T> => {
    ctx.onToolEvent({ name, input, status: 'running' })
    try {
      const result = await run()
      ctx.onToolEvent({ name, input, status: 'ok', summary: describe(result) })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.onToolEvent({ name, input, status: 'error', summary: message })
      throw err
    }
  }

  const listFiles = tool({
    name: 'list_workspace_files',
    description:
      'List markdown and text files in the resume workspace. Use this first to discover the base resume, variants, and apply kits.',
    inputSchema: z.object({
      subdirectory: z
        .string()
        .default('')
        .describe('Optional subdirectory to list, relative to the workspace root.'),
    }),
    callback: async ({ subdirectory }) =>
      track(
        'list_workspace_files',
        { subdirectory },
        async () => {
          const root = requireWorkspace(ctx)
          const dir = resolveInWorkspace(root, subdirectory || '.')
          const out: string[] = []
          const walk = async (current: string, depth: number) => {
            if (depth > 3) return
            for (const entry of await fs.readdir(current, { withFileTypes: true })) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
              const full = path.join(current, entry.name)
              if (entry.isDirectory()) await walk(full, depth + 1)
              else if (/\.(md|txt|csv)$/i.test(entry.name)) {
                out.push(path.relative(root, full).replace(/\\/g, '/'))
              }
            }
          }
          await walk(dir, 0)
          return out.slice(0, 200)
        },
        (files) => `${files.length} file(s)`,
      ),
  })

  const readFile = tool({
    name: 'read_resume_file',
    description:
      'Read a markdown file from the workspace, such as the base resume or a role variant. Returns the file text.',
    inputSchema: z.object({
      relativePath: z
        .string()
        .describe('Path relative to the workspace root, e.g. base-resume.md or variants/backend.md'),
    }),
    callback: async ({ relativePath }) =>
      track(
        'read_resume_file',
        { relativePath },
        async () => {
          const root = requireWorkspace(ctx)
          const target = resolveInWorkspace(root, relativePath)
          if (!fsSync.existsSync(target)) throw new Error(`File not found: ${relativePath}`)
          const text = await fs.readFile(target, 'utf8')
          return { relativePath, content: text.slice(0, MAX_READ_CHARS) }
        },
        (r) => `${r.content.length} chars`,
      ),
  })

  const search = tool({
    name: 'search_workspace',
    description:
      'Full-text search across the workspace. Use it to find where a skill, employer, or metric is already mentioned before rewriting anything.',
    inputSchema: z.object({
      query: z.string().describe('Text to search for.'),
    }),
    callback: async ({ query }) =>
      track(
        'search_workspace',
        { query },
        async () => {
          const root = requireWorkspace(ctx)
          const hits = await searchWorkspace(root, query, 25)
          return hits.map((h) => ({
            relativePath: h.relativePath,
            line: h.line,
            preview: h.preview,
          }))
        },
        (hits) => `${hits.length} match(es)`,
      ),
  })

  const research = tool({
    name: 'research_job',
    description:
      'Fetch a job posting (and a few company pages) and return ranked evidence snippets S1..Sn with source URLs. Requires the user to have enabled web research.',
    inputSchema: z.object({
      url: z.string().default('').describe('Job posting URL. Leave empty when using pastedText.'),
      pastedText: z
        .string()
        .default('')
        .describe('Raw job description text, used when the URL is blocked or unavailable.'),
    }),
    callback: async ({ url, pastedText }) =>
      track(
        'research_job',
        { url, pastedText: pastedText ? `${pastedText.slice(0, 40)}…` : '' },
        async () => {
          if (url.trim() && !ctx.allowWebResearch) {
            throw new Error(
              'Web research is disabled. Ask the user to enable it in Settings, or supply pastedText.',
            )
          }
          const context = await fetchJobContext({
            workspace: ctx.workspace,
            url: url.trim(),
            pastedText,
            topK: 8,
          })
          return {
            company: context.company,
            title: context.title,
            snippets: context.snippets.map((s) => ({
              id: s.id,
              kind: s.kind,
              score: s.score,
              sourceUrl: s.sourceUrl,
              text: s.text,
            })),
          }
        },
        (r) => `${r.snippets.length} snippet(s) from ${r.company || 'pasted text'}`,
      ),
  })

  const proposeEdit = tool({
    name: 'propose_edit',
    description:
      'Propose a rewrite of a resume file. This does NOT write the file — the user reviews a diff and approves it. Call this once per file with the complete new content. Cite evidence snippet ids when the change is driven by a job posting.',
    inputSchema: z.object({
      relativePath: z.string().describe('File to rewrite, relative to the workspace root.'),
      newContent: z.string().describe('The complete new file content.'),
      rationale: z.string().describe('Short explanation of what changed and why.'),
      evidence: z
        .array(z.string())
        .default([])
        .describe('Evidence snippet ids (e.g. ["S1","S4"]) that justify this change.'),
    }),
    callback: async ({ relativePath, newContent, rationale, evidence }) =>
      track(
        'propose_edit',
        { relativePath, rationale },
        async () => {
          const root = requireWorkspace(ctx)
          const target = resolveInWorkspace(root, relativePath)
          const before = fsSync.existsSync(target) ? await fs.readFile(target, 'utf8') : ''
          if (before === newContent) {
            return { accepted: false, reason: 'No change relative to the current file.' }
          }
          ctx.proposals.push({
            id: `p${ctx.proposals.length + 1}`,
            relativePath,
            before,
            after: newContent,
            rationale,
            evidence,
          })
          return {
            accepted: true,
            reason:
              'Proposal recorded and queued for user review. Do not call propose_edit again for this file.',
          }
        },
        (r) => (r.accepted ? 'queued for review' : r.reason),
      ),
  })

  return [listFiles, readFile, search, research, proposeEdit]
}
