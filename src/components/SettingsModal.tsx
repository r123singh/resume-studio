import { useEffect, useState } from 'react'
import {
  FREE_PROVIDERS,
  isManagedProvider,
  MODEL_OPTIONS,
  PAID_PROVIDERS,
  supportsAgentMode,
  type ProviderId,
} from '../lib/ai/providers'
import { AccountPanel } from './AccountPanel'

type Props = {
  onClose: () => void
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  managed: 'Resume Studio AI (account)',
  nvidia: 'NVIDIA NIM (free)',
  groq: 'Groq (free)',
  cursor: 'Cursor SDK',
  bedrock: 'Bedrock',
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

export function SettingsPane({ onClose }: Props) {
  const [provider, setProvider] = useState<ProviderId>('nvidia')
  const [model, setModel] = useState(MODEL_OPTIONS.nvidia[0])
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [groqKey, setGroqKey] = useState('')
  const [cursorKey, setCursorKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [bedrockAccessKeyId, setBedrockAccessKeyId] = useState('')
  const [bedrockSecretAccessKey, setBedrockSecretAccessKey] = useState('')
  const [awsRegion, setAwsRegion] = useState('us-east-1')
  const [agentMode, setAgentMode] = useState(true)
  const [flags, setFlags] = useState({
    nvidia: false,
    groq: false,
    cursor: false,
    openai: false,
    anthropic: false,
    gemini: false,
    bedrock: false,
    bedrockAccessKeyId: false,
    bedrockSecretAccessKey: false,
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
        groq: s.hasGroq,
        cursor: s.hasCursor,
        openai: s.hasOpenAI,
        anthropic: s.hasAnthropic,
        gemini: s.hasGemini,
        bedrock: s.hasBedrock,
        bedrockAccessKeyId: s.hasBedrockAccessKeyId,
        bedrockSecretAccessKey: s.hasBedrockSecretAccessKey,
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
    // The managed provider has no client-side model list; the backend routes it.
    if (!models.length) return
    if (provider === 'bedrock') {
      const fromOtherProvider = (
        Object.entries(MODEL_OPTIONS) as [ProviderId, string[]][]
      ).some(([id, list]) => id !== 'bedrock' && list.includes(model))
      if (fromOtherProvider || !model.trim()) setModel(models[0])
      return
    }
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
        groqKey: groqKey.trim() || undefined,
        cursorKey: cursorKey.trim() || undefined,
        openaiKey: openaiKey.trim() || undefined,
        anthropicKey: anthropicKey.trim() || undefined,
        geminiKey: geminiKey.trim() || undefined,
        bedrockAccessKeyId: bedrockAccessKeyId.trim() || undefined,
        bedrockSecretAccessKey: bedrockSecretAccessKey.trim() || undefined,
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
        groq: s.hasGroq,
        cursor: s.hasCursor,
        openai: s.hasOpenAI,
        anthropic: s.hasAnthropic,
        gemini: s.hasGemini,
        bedrock: s.hasBedrock,
        bedrockAccessKeyId: s.hasBedrockAccessKeyId,
        bedrockSecretAccessKey: s.hasBedrockSecretAccessKey,
      })
      setNvidiaKey('')
      setGroqKey('')
      setCursorKey('')
      setOpenaiKey('')
      setAnthropicKey('')
      setGeminiKey('')
      setBedrockAccessKeyId('')
      setBedrockSecretAccessKey('')
      setMessage('Saved. Keys are stored encrypted on this machine.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings-pane" role="region" aria-label="Settings">
      <div className="settings-pane-header">
        <h2>Settings</h2>
        <button type="button" className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="settings-pane-body">
        <div className="settings-pane-inner">
        <p className="muted">
          Default: free NVIDIA NIM, Groq, or Cursor SDK. Paid providers are optional. Keys stay on
          this machine except when calling the selected provider.
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

        {isManagedProvider(provider) ? (
          <fieldset className="privacy-fieldset">
            <legend>Account</legend>
            <AccountPanel />
          </fieldset>
        ) : provider !== 'bedrock' ? (
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
        ) : null}

        {provider === 'bedrock' || flags.bedrock ? (
          <fieldset className="bedrock-settings">
            <div className="bedrock-settings-head">
              <h3>Bedrock</h3>
              <p>
                Configure Bedrock to use models through your AWS account. Access keys stay encrypted
                on this machine.
              </p>
            </div>
            <div className="bedrock-kv">
              <label className="bedrock-kv-row">
                <span>Access Key ID</span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    flags.bedrockAccessKeyId ? '•••••••• (leave blank to keep)' : 'AWS Access Key ID'
                  }
                  value={bedrockAccessKeyId}
                  onChange={(e) => setBedrockAccessKeyId(e.target.value)}
                />
              </label>
              <label className="bedrock-kv-row">
                <span>Secret Access Key</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    flags.bedrockSecretAccessKey
                      ? '•••••••• (leave blank to keep)'
                      : 'AWS Secret Access Key'
                  }
                  value={bedrockSecretAccessKey}
                  onChange={(e) => setBedrockSecretAccessKey(e.target.value)}
                />
              </label>
              <label className="bedrock-kv-row">
                <span>Region</span>
                <input
                  type="text"
                  list="aws-regions"
                  placeholder="e.g. us-east-1"
                  value={awsRegion}
                  onChange={(e) => setAwsRegion(e.target.value)}
                />
              </label>
              {provider === 'bedrock' ? (
                <label className="bedrock-kv-row">
                  <span>Test Model</span>
                  <input
                    type="text"
                    list="bedrock-models"
                    spellCheck={false}
                    placeholder="e.g. us.anthropic.claude-sonnet-4-6"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <datalist id="aws-regions">
              {AWS_REGIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <datalist id="bedrock-models">
              {MODEL_OPTIONS.bedrock.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </fieldset>
        ) : null}

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
              unavailable. Pick Groq, NVIDIA, Bedrock, OpenAI, Anthropic, or Gemini to enable it.
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
            <span>Allow external AI (NVIDIA / Groq / Cursor / paid providers)</span>
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

        {provider === 'groq' || flags.groq ? (
          <label className="field">
            <span>
              Groq API key {flags.groq ? '(saved)' : ''} — from{' '}
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
                console.groq.com
              </a>
              {' '}(no credit card)
            </span>
            <input
              type="password"
              placeholder={flags.groq ? '•••••••• (leave blank to keep)' : 'gsk_...'}
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
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
    </section>
  )
}
