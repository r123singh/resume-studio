export type ProviderId = 'nvidia' | 'cursor' | 'openai' | 'anthropic' | 'gemini'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function completeHttpChat(args: {
  provider: Exclude<ProviderId, 'cursor'>
  model: string
  apiKey: string
  messages: ChatMessage[]
}): Promise<string> {
  const { provider, model, apiKey, messages } = args
  if (!apiKey.trim()) {
    throw new Error(`Missing API key for ${provider}. Open Settings to add one.`)
  }

  if (provider === 'nvidia') {
    return callOpenAICompatible(
      model,
      apiKey,
      messages,
      'https://integrate.api.nvidia.com/v1',
    )
  }
  if (provider === 'openai') {
    return callOpenAICompatible(model, apiKey, messages, 'https://api.openai.com/v1')
  }
  if (provider === 'anthropic') return callAnthropic(model, apiKey, messages)
  return callGemini(model, apiKey, messages)
}

async function callOpenAICompatible(
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  baseUrl: string,
) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages,
        stream: false,
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Network error calling ${url}: ${msg}`)
  }

  const raw = await res.text()
  let data: {
    error?: { message?: string }
    choices?: Array<{ message?: { content?: string } }>
  }
  try {
    data = JSON.parse(raw) as typeof data
  } catch {
    throw new Error(`Bad response (${res.status}) from ${url}: ${raw.slice(0, 240)}`)
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `API error ${res.status} from ${url}`)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content?.trim()) {
    throw new Error('Model returned an empty response. Try another model or check your API key.')
  }
  return content.trim()
}

async function callAnthropic(model: string, apiKey: string, messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const converted = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }))

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        temperature: 0.3,
        system: system || undefined,
        messages: converted,
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Network error calling Anthropic: ${msg}`)
  }

  const data = (await res.json()) as {
    error?: { message?: string }
    content?: Array<{ type: string; text?: string }>
  }
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic error ${res.status}`)
  }
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n')
  if (!text.trim()) throw new Error('Anthropic returned an empty response.')
  return text.trim()
}

async function callGemini(model: string, apiKey: string, messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: { temperature: 0.3 },
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Network error calling Gemini: ${msg}`)
  }

  const data = (await res.json()) as {
    error?: { message?: string }
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini error ${res.status}`)
  }
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  if (!text.trim()) throw new Error('Gemini returned an empty response.')
  return text.trim()
}
