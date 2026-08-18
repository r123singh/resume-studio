import simpleGit, { type StatusResult } from 'simple-git'
import path from 'node:path'
import fs from 'node:fs/promises'

export type GitStatusPayload = {
  isRepo: boolean
  branch: string | null
  staged: string[]
  modified: string[]
  not_added: string[]
  deleted: string[]
  conflicted: string[]
  ahead: number
  behind: number
  summary: string
}

export type GitDiffPayload = {
  staged: string
  unstaged: string
}

async function isGitRepo(root: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, '.git'))
    return true
  } catch {
    return false
  }
}

export async function gitStatus(root: string): Promise<GitStatusPayload> {
  if (!(await isGitRepo(root))) {
    return {
      isRepo: false,
      branch: null,
      staged: [],
      modified: [],
      not_added: [],
      deleted: [],
      conflicted: [],
      ahead: 0,
      behind: 0,
      summary: 'Not a git repository',
    }
  }
  const git = simpleGit(root)
  const status: StatusResult = await git.status()
  const parts: string[] = []
  if (status.staged.length) parts.push(`${status.staged.length} staged`)
  if (status.modified.length) parts.push(`${status.modified.length} modified`)
  if (status.not_added.length) parts.push(`${status.not_added.length} untracked`)
  if (status.deleted.length) parts.push(`${status.deleted.length} deleted`)
  return {
    isRepo: true,
    branch: status.current,
    staged: status.staged,
    modified: status.modified,
    not_added: status.not_added,
    deleted: status.deleted,
    conflicted: status.conflicted,
    ahead: status.ahead,
    behind: status.behind,
    summary: parts.length ? parts.join(' · ') : 'Clean working tree',
  }
}

export async function gitDiff(root: string): Promise<GitDiffPayload> {
  if (!(await isGitRepo(root))) {
    return { staged: '', unstaged: '' }
  }
  const git = simpleGit(root)
  const [staged, unstaged] = await Promise.all([
    git.diff(['--cached']),
    git.diff(),
  ])
  return { staged: staged || '', unstaged: unstaged || '' }
}

export async function gitCommit(
  root: string,
  message: string,
  paths?: string[],
): Promise<{ commit: string }> {
  if (!(await isGitRepo(root))) {
    throw new Error('Not a git repository. Run git init in the workspace first.')
  }
  const msg = message.trim()
  if (!msg) throw new Error('Commit message is required.')

  const git = simpleGit(root)
  if (paths?.length) {
    await git.add(paths)
  } else {
    await git.add(['-A'])
  }
  const result = await git.commit(msg)
  return { commit: result.commit || 'ok' }
}

export async function gitInit(root: string): Promise<boolean> {
  const git = simpleGit(root)
  await git.init()
  return true
}
