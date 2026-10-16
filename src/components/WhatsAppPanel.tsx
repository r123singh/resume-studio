import { useMemo } from 'react'
import { MessageCircle } from 'lucide-react'
import { EmptyState } from './ui/EmptyState'
import {
  scorePhoneSkim,
  type ParsedChat,
  type PhoneSkim,
  type WhatsAppPacket,
} from '../lib/whatsapp'

type Props = {
  paste: string
  parsed: ParsedChat | null
  packet: WhatsAppPacket
  recruiter: string
  phone: string
  company: string
  role: string
  location: string
  jobUrl: string
  busy: boolean
  composing: boolean
  kitHint?: string
  onPasteChange: (value: string) => void
  onRecruiterChange: (value: string) => void
  onPhoneChange: (value: string) => void
  onCompanyChange: (value: string) => void
  onRoleChange: (value: string) => void
  onLocationChange: (value: string) => void
  onJobUrlChange: (value: string) => void
  onPingChange: (value: string) => void
  onWhyChange: (value: string) => void
  onBumpChange: (value: string) => void
  onParse: () => void
  onSample: () => void
  onCompose: () => void
  onTailor: () => void
  onOpenWhatsApp: (kind: 'ping' | 'bump' | 'self') => void
  onCopy: (kind: 'ping' | 'why' | 'bump') => void
  onRevealPdf?: () => void
}

export function WhatsAppPanel({
  paste,
  parsed,
  packet,
  recruiter,
  phone,
  company,
  role,
  location,
  jobUrl,
  busy,
  composing,
  kitHint,
  onPasteChange,
  onRecruiterChange,
  onPhoneChange,
  onCompanyChange,
  onRoleChange,
  onLocationChange,
  onJobUrlChange,
  onPingChange,
  onWhyChange,
  onBumpChange,
  onParse,
  onSample,
  onCompose,
  onTailor,
  onOpenWhatsApp,
  onCopy,
  onRevealPdf,
}: Props) {
  const skim: PhoneSkim = useMemo(
    () => scorePhoneSkim(packet.ping, parsed || undefined),
    [packet.ping, parsed],
  )
  const canSend = Boolean(packet.ping.trim())

  return (
    <div className="ping-panel">
      <p className="ping-lede">
        Paste a recruiter WhatsApp thread. Resume Studio writes a phone-length ping — not a cover
        letter — then opens WhatsApp with the tailored PDF ready to attach.
      </p>

      <label className="ping-label" htmlFor="ping-paste">
        Recruiter chat or forwarded JD
      </label>
      <textarea
        id="ping-paste"
        placeholder="Paste the WhatsApp export, a forwarded JD, or “pls share CV”…"
        value={paste}
        onChange={(e) => onPasteChange(e.target.value)}
        rows={7}
      />
      <div className="ping-actions">
        <button type="button" className="btn ghost" disabled={!paste.trim()} onClick={onParse}>
          Parse thread
        </button>
        <button type="button" className="btn ghost" onClick={onSample}>
          Load sample
        </button>
      </div>

      {!parsed ? (
        <EmptyState
          icon={MessageCircle}
          compact
          title="WhatsApp is the apply channel"
          description="Most recruiter JDs in India and SEA never hit an ATS. Parse a thread to draft the ping locally — no model required."
        />
      ) : (
        <>
          <div className="ping-fields">
            <input
              placeholder="Recruiter"
              value={recruiter}
              onChange={(e) => onRecruiterChange(e.target.value)}
              aria-label="Recruiter name"
            />
            <input
              placeholder="Phone (with country code)"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              aria-label="Recruiter phone"
            />
            <input
              placeholder="Company"
              value={company}
              onChange={(e) => onCompanyChange(e.target.value)}
              aria-label="Company"
            />
            <input
              placeholder="Role"
              value={role}
              onChange={(e) => onRoleChange(e.target.value)}
              aria-label="Role"
            />
            <input
              placeholder="Location"
              value={location}
              onChange={(e) => onLocationChange(e.target.value)}
              aria-label="Location"
            />
            <input
              placeholder="Job URL"
              value={jobUrl}
              onChange={(e) => onJobUrlChange(e.target.value)}
              aria-label="Job URL"
            />
          </div>

          <div className="ping-skim" aria-live="polite">
            <div className="ping-skim-top">
              <span>Phone skim</span>
              <strong className={skim.score >= 80 ? 'ok' : skim.score >= 55 ? 'mid' : 'low'}>
                {skim.score}
              </strong>
            </div>
            <div className="ping-skim-bar" role="meter" aria-valuenow={skim.score} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${skim.score}%` }} />
            </div>
            <div className="ping-skim-meta">
              {skim.chars} chars · {skim.lines} lines · budget 700
            </div>
            {skim.issues.length ? (
              <ul className="ping-issues">
                {skim.issues.map((issue) => (
                  <li key={issue.id} className={issue.severity}>
                    {issue.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ping-skim-ok">Reads like a text, not an email.</p>
            )}
          </div>

          <label className="ping-label" htmlFor="ping-body">
            Ping
          </label>
          <textarea
            id="ping-body"
            value={packet.ping}
            onChange={(e) => onPingChange(e.target.value)}
            rows={6}
          />
          <label className="ping-label" htmlFor="ping-why">
            Why-fit (send only if they ask)
          </label>
          <textarea
            id="ping-why"
            value={packet.why}
            onChange={(e) => onWhyChange(e.target.value)}
            rows={4}
          />
          <label className="ping-label" htmlFor="ping-bump">
            48h bump
          </label>
          <textarea
            id="ping-bump"
            value={packet.bump}
            onChange={(e) => onBumpChange(e.target.value)}
            rows={3}
          />

          <div className="ping-actions wrap">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !canSend}
              onClick={() => onOpenWhatsApp('ping')}
            >
              Open WhatsApp
            </button>
            <button type="button" className="btn ghost" disabled={!packet.ping.trim()} onClick={() => onCopy('ping')}>
              Copy ping
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy || composing}
              onClick={onCompose}
            >
              {composing ? 'Polishing…' : 'Polish with AI'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy || !company.trim() || !role.trim()}
              onClick={onTailor}
            >
              Tailor + kit
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!packet.bump.trim()}
              onClick={() => onOpenWhatsApp('bump')}
            >
              Send bump
            </button>
            <button type="button" className="btn ghost" onClick={() => onOpenWhatsApp('self')}>
              Send kit to my phone
            </button>
            {onRevealPdf && kitHint ? (
              <button type="button" className="btn ghost" onClick={onRevealPdf}>
                Reveal PDF
              </button>
            ) : null}
          </div>
          {kitHint ? <p className="ping-kit-hint">{kitHint}</p> : (
            <p className="ping-kit-hint">
              WhatsApp opens with the ping. Attach resume.pdf from the apply kit — the link cannot
              attach files.
            </p>
          )}
        </>
      )}
    </div>
  )
}
