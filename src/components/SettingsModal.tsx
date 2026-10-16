import { useCallback, useEffect, useState } from 'react'
import {
  FREE_PROVIDERS,
  MODEL_OPTIONS,
  PAID_PROVIDERS,
  supportsAgentMode,
  type ProviderId,
} from '../lib/ai/providers'
import { SMTP_PRESETS, smtpFromImapHost } from '../lib/mail'

type Props = {
  onClose: () => void
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  managed: 'Resume Studio AI (account)',
  nvidia: 'NVIDIA NIM (free)',
  ollama: 'Ollama (local)',
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

function formatOllamaSize(bytes?: number): string {
  if (!bytes) return ''
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

export function SettingsPane({ onClose }: Props) {
  const [provider, setProvider] = useState<ProviderId>('nvidia')
  const [model, setModel] = useState(MODEL_OPTIONS.nvidia[0])
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://127.0.0.1:11434/v1')
  const [ollamaModels, setOllamaModels] = useState<Array<{ name: string; size?: number }>>([])
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false)
  const [ollamaModelsError, setOllamaModelsError] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [bedrockAccessKeyId, setBedrockAccessKeyId] = useState('')
  const [bedrockSecretAccessKey, setBedrockSecretAccessKey] = useState('')
  const [awsRegion, setAwsRegion] = useState('us-east-1')
  const [agentMode, setAgentMode] = useState(true)
  const [flags, setFlags] = useState({
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
  const [imapPreset, setImapPreset] = useState<'gmail' | 'outlook' | 'yahoo' | 'zoho' | 'icloud' | 'custom'>('gmail')
  const [imapHost, setImapHost] = useState('imap.gmail.com')
  const [imapPort, setImapPort] = useState('993')
  const [imapUser, setImapUser] = useState('')
  const [imapPassword, setImapPassword] = useState('')
  const [imapMailbox, setImapMailbox] = useState('INBOX')
  const [imapLookbackDays, setImapLookbackDays] = useState('14')
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com')
  const [smtpPort, setSmtpPort] = useState('587')
  const [hasImap, setHasImap] = useState(false)
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
      setOllamaBaseUrl(s.ollamaBaseUrl || 'http://127.0.0.1:11434/v1')
      setImapHost(s.imapHost || 'imap.gmail.com')
      setImapPort(String(s.imapPort || 993))
      setImapUser(s.imapUser || '')
      setImapMailbox(s.imapMailbox || 'INBOX')
      setImapLookbackDays(String(s.imapLookbackDays || 14))
      const derivedSmtp = smtpFromImapHost(s.imapHost || 'imap.gmail.com')
      setSmtpHost(s.smtpHost || derivedSmtp.host)
      setSmtpPort(String(s.smtpPort || derivedSmtp.port))
      setHasImap(Boolean(s.hasImap))
      const host = (s.imapHost || 'imap.gmail.com').toLowerCase()
      if (host.includes('gmail')) setImapPreset('gmail')
      else if (host.includes('office365') || host.includes('outlook')) setImapPreset('outlook')
      else if (host.includes('yahoo')) setImapPreset('yahoo')
      else if (host.includes('zoho')) setImapPreset('zoho')
      else if (host.includes('mail.me.com')) setImapPreset('icloud')
      else setImapPreset(s.imapHost ? 'custom' : 'gmail')
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
    if (provider === 'ollama') return
    if (!models.includes(model)) setModel(models[0])
  }, [provider, model])

  const refreshOllamaModels = useCallback(async () => {
    setOllamaModelsLoading(true)
    setOllamaModelsError('')
    try {
      const models = await window.resumeStudio.listOllamaModels(ollamaBaseUrl)
      setOllamaModels(models)
      if (models.length === 0) {
        setOllamaModelsError('No models found. Run `ollama pull <model>` first.')
        return
      }
      setModel((current) => (models.some((m) => m.name === current) ? current : models[0].name))
    } catch (err) {
      setOllamaModels([])
      setOllamaModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setOllamaModelsLoading(false)
    }
  }, [ollamaBaseUrl])

  useEffect(() => {
    if (provider !== 'ollama') return
    const timer = window.setTimeout(() => {
      void refreshOllamaModels()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [provider, ollamaBaseUrl, refreshOllamaModels])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      await window.resumeStudio.setSettings({
        provider,
        model,
        ollamaBaseUrl: ollamaBaseUrl.trim() || undefined,
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
        imapHost,
        imapPort: Number(imapPort) || 993,
        imapUser,
        imapPassword: imapPassword.trim() || undefined,
        imapMailbox,
        imapLookbackDays: Number(imapLookbackDays) || 14,
        smtpHost,
        smtpPort: Number(smtpPort) || 587,
      })
      const s = await window.resumeStudio.getSettings()
      setFlags({
        openai: s.hasOpenAI,
        anthropic: s.hasAnthropic,
        gemini: s.hasGemini,
        bedrock: s.hasBedrock,
        bedrockAccessKeyId: s.hasBedrockAccessKeyId,
        bedrockSecretAccessKey: s.hasBedrockSecretAccessKey,
      })
      setOpenaiKey('')
      setAnthropicKey('')
      setGeminiKey('')
      setBedrockAccessKeyId('')
      setBedrockSecretAccessKey('')
      setImapPassword('')
      setHasImap(s.hasImap)
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
          Default: NVIDIA NIM (included) or Ollama (local). Paid providers are optional.
          Paid keys stay on this machine except when calling that provider.
        </p>

        <label className="field">
          <span>Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
          >
            <optgroup label="Free">
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

        {provider === 'ollama' ? (
          <fieldset className="bedrock-settings">
            <div className="bedrock-settings-head">
              <h3>Ollama</h3>
              <p>
                Run models locally with{' '}
                <a href="https://ollama.com" target="_blank" rel="noreferrer">
                  Ollama
                </a>
                . No API key — traffic stays on this machine. Models are loaded from your running
                Ollama instance.
              </p>
            </div>
            <div className="bedrock-kv">
              <label className="bedrock-kv-row">
                <span>Base URL</span>
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="http://127.0.0.1:11434/v1"
                  value={ollamaBaseUrl}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                />
              </label>
              <label className="bedrock-kv-row">
                <span>Model</span>
                <div className="ollama-model-row">
                  <select
                    value={model}
                    disabled={ollamaModelsLoading || ollamaModels.length === 0}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {ollamaModels.length === 0 ? (
                      <option value={model || ''}>
                        {ollamaModelsLoading ? 'Loading models…' : model || 'No models'}
                      </option>
                    ) : (
                      ollamaModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                          {m.size ? ` (${formatOllamaSize(m.size)})` : ''}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={ollamaModelsLoading}
                    onClick={() => void refreshOllamaModels()}
                  >
                    {ollamaModelsLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </label>
            </div>
            {ollamaModelsError ? <p className="settings-msg">{ollamaModelsError}</p> : null}
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
              unavailable. Pick NVIDIA, Ollama, Bedrock, OpenAI, Anthropic, or Gemini to enable it.
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
            <span>
              Allow external AI (NVIDIA and paid providers). Ollama (local) works even when this is off.
            </span>
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

        <fieldset className="privacy-fieldset">
          <legend>Mail (IMAP + SMTP)</legend>
          <p className="muted small">
            Fetch inbox over IMAP and send replies over SMTP with the same app password — not your
            main login. The password is encrypted with OS safeStorage and never sent to an LLM.
            Resume Studio never auto-sends; you click Send reply.
          </p>
          <label className="field">
            <span>Provider</span>
            <select
              value={imapPreset}
              onChange={(e) => {
                const next = e.target.value as typeof imapPreset
                setImapPreset(next)
                if (next !== 'custom') {
                  const smtp = SMTP_PRESETS[next]
                  if (next === 'gmail') {
                    setImapHost('imap.gmail.com')
                    setImapPort('993')
                  } else if (next === 'outlook') {
                    setImapHost('outlook.office365.com')
                    setImapPort('993')
                  } else if (next === 'yahoo') {
                    setImapHost('imap.mail.yahoo.com')
                    setImapPort('993')
                  } else if (next === 'zoho') {
                    setImapHost('imap.zoho.com')
                    setImapPort('993')
                  } else if (next === 'icloud') {
                    setImapHost('imap.mail.me.com')
                    setImapPort('993')
                  }
                  setSmtpHost(smtp.host)
                  setSmtpPort(String(smtp.port))
                }
              }}
            >
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook / Microsoft 365</option>
              <option value="yahoo">Yahoo</option>
              <option value="zoho">Zoho</option>
              <option value="icloud">iCloud</option>
              <option value="custom">Custom IMAP</option>
            </select>
          </label>
          <label className="field">
            <span>IMAP host</span>
            <input
              value={imapHost}
              onChange={(e) => {
                setImapHost(e.target.value)
                setImapPreset('custom')
              }}
              placeholder="imap.gmail.com"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Port</span>
            <input
              value={imapPort}
              onChange={(e) => setImapPort(e.target.value)}
              placeholder="993"
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>Email address</span>
            <input
              value={imapUser}
              onChange={(e) => setImapUser(e.target.value)}
              placeholder="you@gmail.com"
              spellCheck={false}
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span>App password {hasImap ? '(saved)' : ''}</span>
            <input
              type="password"
              value={imapPassword}
              onChange={(e) => setImapPassword(e.target.value)}
              placeholder={hasImap ? '•••••••• (leave blank to keep)' : '16-character app password'}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>Mailbox</span>
            <input
              value={imapMailbox}
              onChange={(e) => setImapMailbox(e.target.value)}
              placeholder="INBOX"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Lookback days</span>
            <input
              value={imapLookbackDays}
              onChange={(e) => setImapLookbackDays(e.target.value)}
              placeholder="14"
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>SMTP host</span>
            <input
              value={smtpHost}
              onChange={(e) => {
                setSmtpHost(e.target.value)
                setImapPreset('custom')
              }}
              placeholder="smtp.gmail.com"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>SMTP port (587 STARTTLS, 465 SSL)</span>
            <input
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder="587"
              inputMode="numeric"
            />
          </label>
        </fieldset>

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
