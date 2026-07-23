export type ProviderId = 'openai' | 'anthropic' | 'gemini'

export const MODEL_OPTIONS: Record<ProviderId, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  anthropic: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-sonnet-4-20250514'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function completeChat(args: {
  provider: ProviderId
  model: string
  apiKey: string
  messages: ChatMessage[]
}): Promise<string> {
  const { provider, model, apiKey, messages } = args
  if (!apiKey.trim()) {
    throw new Error(`Missing API key for ${provider}. Open Settings to add one.`)
  }

  if (provider === 'openai') return callOpenAI(model, apiKey, messages)
  if (provider === 'anthropic') return callAnthropic(model, apiKey, messages)
  return callGemini(model, apiKey, messages)
}

async function callOpenAI(model: string, apiKey: string, messages: ChatMessage[]) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages,
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI error ${res.status}`)
  }
  return String(data.choices?.[0]?.message?.content || '').trim()
}

async function callAnthropic(model: string, apiKey: string, messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const converted = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }))

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      temperature: 0.3,
      system: system || undefined,
      messages: converted,
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic error ${res.status}`)
  }
  const text = (data.content || [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')
  return String(text).trim()
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: { temperature: 0.3 },
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini error ${res.status}`)
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || ''
  return String(text).trim()
}
