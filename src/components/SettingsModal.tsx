import { useEffect, useState } from 'react'
import { MODEL_OPTIONS, type ProviderId } from '../lib/ai/providers'

type Props = {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  const [provider, setProvider] = useState<ProviderId>('openai')
  const [model, setModel] = useState('gpt-4o-mini')
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [flags, setFlags] = useState({ openai: false, anthropic: false, gemini: false })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    ;(async () => {
      const s = await window.resumeStudio.getSettings()
      setProvider(s.provider)
      setModel(s.model)
      setFlags({
        openai: s.hasOpenAI,
        anthropic: s.hasAnthropic,
        gemini: s.hasGemini,
      })
    })()
  }, [])

  useEffect(() => {
    const models = MODEL_OPTIONS[provider]
    if (!models.includes(model)) setModel(models[0])
  }, [provider, model])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      await window.resumeStudio.setSettings({
        provider,
        model,
        openaiKey: openaiKey.trim() || undefined,
        anthropicKey: anthropicKey.trim() || undefined,
        geminiKey: geminiKey.trim() || undefined,
      })
      const s = await window.resumeStudio.getSettings()
      setFlags({
        openai: s.hasOpenAI,
        anthropic: s.hasAnthropic,
        gemini: s.hasGemini,
      })
      setOpenaiKey('')
      setAnthropicKey('')
      setGeminiKey('')
      setMessage('Saved. Keys are stored encrypted on this machine.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          Bring your own API key. Keys never leave your machine except to call the selected
          provider.
        </p>

        <label className="field">
          <span>Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>

        <label className="field">
          <span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODEL_OPTIONS[provider].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>OpenAI API key {flags.openai ? '(saved)' : ''}</span>
          <input
            type="password"
            placeholder={flags.openai ? '•••••••• (leave blank to keep)' : 'sk-...'}
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Anthropic API key {flags.anthropic ? '(saved)' : ''}</span>
          <input
            type="password"
            placeholder={flags.anthropic ? '•••••••• (leave blank to keep)' : 'sk-ant-...'}
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Gemini API key {flags.gemini ? '(saved)' : ''}</span>
          <input
            type="password"
            placeholder={flags.gemini ? '•••••••• (leave blank to keep)' : 'AIza...'}
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
          />
        </label>

        {message ? <p className="settings-msg">{message}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
