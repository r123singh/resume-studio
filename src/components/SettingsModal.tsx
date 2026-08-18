import { useEffect, useState } from 'react'
import {
  FREE_PROVIDERS,
  MODEL_OPTIONS,
  PAID_PROVIDERS,
  supportsAgentMode,
  type ProviderId,
} from '../lib/ai/providers'

type Props = {
  onClose: () => void
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  nvidia: 'NVIDIA NIM (free)',
  cursor: 'Cursor SDK',
  bedrock: 'Amazon Bedrock',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

const AWS_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-south-1',
  'ap-southeast-2',
  'ap-northeast-1',
]

export function SettingsModal({ onClose }: Props) {
  const [provider, setProvider] = useState<ProviderId>('nvidia')
  const [model, setModel] = useState(MODEL_OPTIONS.nvidia[0])
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [cursorKey, setCursorKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [bedrockKey, setBedrockKey] = useState('')
  const [awsRegion, setAwsRegion] = useState('us-east-1')
  const [agentMode, setAgentMode] = useState(true)
  const [flags, setFlags] = useState({
    nvidia: false,
    cursor: false,
    openai: false,
    anthropic: false,
    gemini: false,
    bedrock: false,
  })
  const [showPaid, setShowPaid] = useState(false)
  const [allowExternalAi, setAllowExternalAi] = useState(true)
  const [redactPii, setRedactPii] = useState(false)
  const [confirmLargeEdits, setConfirmLargeEdits] = useState(true)
  const [allowWebResearch, setAllowWebResearch] = useState(false)
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
        bedrock: s.hasBedrock,
      })
      setAwsRegion(s.awsRegion || 'us-east-1')
      setAgentMode(s.agentMode !== false)
      setAllowExternalAi(s.allowExternalAi !== false)
      setRedactPii(Boolean(s.redactPii))
      setConfirmLargeEdits(s.confirmLargeEdits !== false)
      setAllowWebResearch(Boolean(s.allowWebResearch))
      if (PAID_PROVIDERS.includes(s.provider)) setShowPaid(true)
    })()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        bedrockKey: bedrockKey.trim() || undefined,
        awsRegion,
        agentMode,
        allowExternalAi,
        redactPii,
        confirmLargeEdits,
        allowWebResearch,
      })
      const s = await window.resumeStudio.getSettings()
      setFlags({
        nvidia: s.hasNvidia,
        cursor: s.hasCursor,
        openai: s.hasOpenAI,
        anthropic: s.hasAnthropic,
        gemini: s.hasGemini,
        bedrock: s.hasBedrock,
      })
      setNvidiaKey('')
      setCursorKey('')
      setOpenaiKey('')
      setAnthropicKey('')
      setGeminiKey('')
      setBedrockKey('')
      setMessage('Saved. Keys are stored encrypted on this machine.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
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

        <fieldset className="privacy-fieldset">
          <legend>Agent</legend>
          <label className="check-row">
            <input
              type="checkbox"
              checked={agentMode}
              disabled={!supportsAgentMode(provider)}
              onChange={(e) => setAgentMode(e.target.checked)}
            />
            <span>
              Agent mode — the model reads your files, researches the job, and plans edits with
              tools instead of a single prompt
            </span>
          </label>
          {supportsAgentMode(provider) ? (
            <p className="muted small">
              Proposed edits are never written directly. You review a diff before anything changes.
            </p>
          ) : (
            <p className="muted small">
              {PROVIDER_LABELS[provider]} returns finished text with no tool calls, so agent mode is
              unavailable. Pick Bedrock, NVIDIA, OpenAI, Anthropic, or Gemini to enable it.
            </p>
          )}
        </fieldset>

        <fieldset className="privacy-fieldset">
          <legend>Privacy & safety</legend>
          <label className="check-row">
            <input
              type="checkbox"
              checked={allowExternalAi}
              onChange={(e) => setAllowExternalAi(e.target.checked)}
            />
            <span>Allow external AI (NVIDIA / Cursor / paid providers)</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={redactPii}
              onChange={(e) => setRedactPii(e.target.checked)}
            />
            <span>Redact email / phone / LinkedIn from prompts before send</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmLargeEdits}
              onChange={(e) => setConfirmLargeEdits(e.target.checked)}
            />
            <span>Require diff preview before applying large AI edits</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={allowWebResearch}
              onChange={(e) => setAllowWebResearch(e.target.checked)}
            />
            <span>
              Allow job/company web research (Evidence-Backed Tailor fetches the posting and a few
              company pages)
            </span>
          </label>
        </fieldset>

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

        {provider === 'bedrock' || flags.bedrock ? (
          <>
            <label className="field">
              <span>AWS region</span>
              <select value={awsRegion} onChange={(e) => setAwsRegion(e.target.value)}>
                {AWS_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                Bedrock API key {flags.bedrock ? '(saved)' : ''} — optional; leave blank to use your
                AWS credential chain (profile, env vars, SSO)
              </span>
              <input
                type="password"
                placeholder={flags.bedrock ? '•••••••• (leave blank to keep)' : 'ABSK... (optional)'}
                value={bedrockKey}
                onChange={(e) => setBedrockKey(e.target.value)}
              />
            </label>
          </>
        ) : null}

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
