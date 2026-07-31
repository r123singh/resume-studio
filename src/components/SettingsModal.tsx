import { useEffect, useState } from 'react'
import {
  FREE_PROVIDERS,
  MODEL_OPTIONS,
  PAID_PROVIDERS,
  type ProviderId,
} from '../lib/ai/providers'

type Props = {
  onClose: () => void
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  nvidia: 'NVIDIA NIM (free)',
  cursor: 'Cursor SDK',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

export function SettingsModal({ onClose }: Props) {
  const [provider, setProvider] = useState<ProviderId>('nvidia')
  const [model, setModel] = useState(MODEL_OPTIONS.nvidia[0])
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [cursorKey, setCursorKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [flags, setFlags] = useState({
    nvidia: false,
    cursor: false,
    openai: false,
    anthropic: false,
    gemini: false,
  })
  const [showPaid, setShowPaid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    ;(async () => {
      const s = await window.resumeStudio.getSettings()
      setProvider(s.provider)
      setModel(s.model)
      setFlags({
        nvidia: s.hasNvidia,
        cursor: s.hasCursor,
        openai: s.hasOpenAI,
        anthropic: s.hasAnthropic,
        gemini: s.hasGemini,
      })
      if (PAID_PROVIDERS.includes(s.provider)) setShowPaid(true)
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
        nvidiaKey: nvidiaKey.trim() || undefined,
        cursorKey: cursorKey.trim() || undefined,
        openaiKey: openaiKey.trim() || undefined,
        anthropicKey: anthropicKey.trim() || undefined,
        geminiKey: geminiKey.trim() || undefined,
      })
      const s = await window.resumeStudio.getSettings()
      setFlags({
        nvidia: s.hasNvidia,
        cursor: s.hasCursor,
        openai: s.hasOpenAI,
        anthropic: s.hasAnthropic,
        gemini: s.hasGemini,
      })
      setNvidiaKey('')
      setCursorKey('')
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
          Default: free NVIDIA NIM or Cursor SDK. Paid providers are optional. Keys stay on this
          machine except when calling the selected provider.
        </p>

        <label className="field">
          <span>Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
          >
            <optgroup label="Free / account">
              {FREE_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Paid (optional)">
              {PAID_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </optgroup>
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

        {provider === 'nvidia' || flags.nvidia ? (
          <label className="field">
            <span>
              NVIDIA API key {flags.nvidia ? '(saved)' : ''} — from{' '}
              <a href="https://build.nvidia.com" target="_blank" rel="noreferrer">
                build.nvidia.com
              </a>
            </span>
            <input
              type="password"
              placeholder={flags.nvidia ? '•••••••• (leave blank to keep)' : 'nvapi-...'}
              value={nvidiaKey}
              onChange={(e) => setNvidiaKey(e.target.value)}
            />
          </label>
        ) : null}

        {provider === 'cursor' || flags.cursor ? (
          <label className="field">
            <span>Cursor API key {flags.cursor ? '(saved)' : ''} — CURSOR_API_KEY / service account</span>
            <input
              type="password"
              placeholder={flags.cursor ? '•••••••• (leave blank to keep)' : 'cursor_...'}
              value={cursorKey}
              onChange={(e) => setCursorKey(e.target.value)}
            />
          </label>
        ) : null}

        <button
          type="button"
          className="btn ghost block"
          onClick={() => setShowPaid((v) => !v)}
        >
          {showPaid ? 'Hide paid providers' : 'Show paid providers (optional)'}
        </button>

        {showPaid ? (
          <>
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
          </>
        ) : null}

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
