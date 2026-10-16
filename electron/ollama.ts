export type OllamaModelInfo = {
  name: string
  size?: number
  modifiedAt?: string
}

/** Strip `/v1` so both API root and OpenAI-compat URLs work. */
export function ollamaApiRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim() || 'http://127.0.0.1:11434/v1'
  try {
    const url = new URL(trimmed)
    if (url.pathname.endsWith('/v1')) {
      url.pathname = url.pathname.slice(0, -3) || '/'
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return 'http://127.0.0.1:11434'
  }
}

/** Lists models from a running Ollama instance (`GET /api/tags`). */
export async function listOllamaModels(baseUrl: string): Promise<OllamaModelInfo[]> {
  const root = ollamaApiRoot(baseUrl)
  const res = await fetch(`${root}/api/tags`, {
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    throw new Error(`Ollama returned HTTP ${res.status}. Is \`ollama serve\` running?`)
  }
  const body = (await res.json()) as {
    models?: Array<{ name?: string; size?: number; modified_at?: string }>
  }
  const models = (body.models ?? [])
    .map((m) => ({
      name: String(m.name ?? '').trim(),
      size: typeof m.size === 'number' ? m.size : undefined,
      modifiedAt: m.modified_at,
    }))
    .filter((m) => m.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
  return models
}
