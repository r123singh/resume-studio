/**
 * Managed AI account panel.
 *
 * Everything shown here is read from the backend on demand. The panel keeps no
 * local copy of plan, quota, or billing state, because that state has to follow
 * the account across machines rather than the installation.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AccountState, PlatformStatus } from '../../electron/preload'

/** Backend error codes mapped to copy a user can act on. */
const ERROR_COPY: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Sign in to continue.',
  ACCOUNT_SUSPENDED: 'This account is suspended. Contact support.',
  SUBSCRIPTION_REQUIRED: 'This feature needs an active subscription.',
  AI_ACCESS_DENIED: 'Your plan does not include this operation.',
  USAGE_LIMIT_REACHED: 'You have used all AI requests for this billing period.',
  MODEL_UNAVAILABLE: 'No model is available right now. Try again shortly.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  AI_PROVIDER_ERROR: 'The AI service failed to respond. Try again.',
  NETWORK_UNAVAILABLE: 'Could not reach the AI service. Check your connection.',
  ACCESS_DENIED:
    'The AI service rejected this request (403). Redeploy the control plane so the Function URL allows public invoke.',
  CONFLICT: 'That request is already being processed.',
  INVALID_REQUEST: 'That request was not valid.',
  INTERNAL_ERROR: 'Something went wrong. Try again.',
}

export const describeError = (code: string, fallback: string): string =>
  ERROR_COPY[code] ?? fallback

export function AccountPanel() {
  const [status, setStatus] = useState<PlatformStatus | null>(null)
  const [account, setAccount] = useState<AccountState | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const next = await window.resumeStudio.platformStatus()
    setStatus(next)
    if (!next.signedIn) {
      setAccount(null)
      return
    }
    const result = await window.resumeStudio.platformAccount()
    if (result.ok) {
      setAccount(result.data)
      setError('')
    } else {
      setAccount(null)
      setError(describeError(result.code, result.message))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result =
        mode === 'signUp'
          ? await window.resumeStudio.platformSignUp(email.trim(), password)
          : await window.resumeStudio.platformSignIn(email.trim(), password)
      if (!result.ok) {
        setError(describeError(result.code, result.message))
        return
      }
      setPassword('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    try {
      await window.resumeStudio.platformSignOut()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <p className="muted">Checking account…</p>

  if (!status.configured) {
    return (
      <p className="muted">
        Managed AI is not enabled in this build. Deploy the control plane and set{' '}
        <code>RESUME_STUDIO_API_URL</code> to turn it on. The free NVIDIA provider works without it.
      </p>
    )
  }

  if (!status.signedIn) {
    return (
      <form className="account-panel" onSubmit={submit}>
        <p className="muted">
          Sign in to use Resume Studio AI. Your plan, usage, and AI access follow your account, so
          the same subscription works on every machine you install on.
        </p>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            minLength={10}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {mode === 'signUp' ? (
          <p className="muted small">Passwords must be at least 10 characters.</p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        <div className="row gap">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Working…' : mode === 'signUp' ? 'Create account' : 'Sign in'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setMode(mode === 'signUp' ? 'signIn' : 'signUp')
              setError('')
            }}
          >
            {mode === 'signUp' ? 'I already have an account' : 'Create an account'}
          </button>
        </div>
      </form>
    )
  }

  const entitlements = account?.entitlements
  const usage = account?.usage
  const subscription = account?.subscription
  const used = entitlements?.requestsUsed ?? 0
  const limit = entitlements?.requestsLimit ?? 0
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0

  return (
    <div className="account-panel">
      <div className="row between">
        <div>
          <strong>{status.email}</strong>
          <p className="muted small">
            {entitlements?.planName ?? '—'} plan
            {subscription?.status && subscription.status !== 'active'
              ? ` · ${subscription.status.replace(/_/g, ' ')}`
              : ''}
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={signOut} disabled={busy}>
          Sign out
        </button>
      </div>

      {entitlements?.degradedFrom ? (
        <p className="warn-text">
          Your {entitlements.degradedFrom} subscription is not active, so the free plan limits apply
          until billing is resolved.
        </p>
      ) : null}

      {subscription?.grace_period_ends_at ? (
        <p className="warn-text">
          A payment failed. Access continues until{' '}
          {new Date(subscription.grace_period_ends_at).toLocaleDateString()}.
        </p>
      ) : null}

      <div className="usage-meter">
        <div className="row between small">
          <span>
            {used.toLocaleString()} of {limit.toLocaleString()} requests
          </span>
          <span className="muted">
            resets {entitlements ? new Date(entitlements.periodEnd).toLocaleDateString() : '—'}
          </span>
        </div>
        <div className="meter-track">
          <div
            className="meter-fill"
            style={{ width: `${percent}%` }}
            data-warn={percent >= 80 ? 'true' : 'false'}
          />
        </div>
      </div>

      {usage ? (
        <p className="muted small">
          {usage.input_tokens.toLocaleString()} in / {usage.output_tokens.toLocaleString()} out
          tokens this period.
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <button type="button" className="btn ghost" onClick={() => void refresh()} disabled={busy}>
        Refresh
      </button>
    </div>
  )
}
