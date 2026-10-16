import { Mail } from 'lucide-react'
import { EmptyState } from './ui/EmptyState'
import { normalizeRecipient, type MailListing, type MailReply, type MailSource } from '../lib/mail'

type Props = {
  paste: string
  items: MailListing[]
  selectedId: string | null
  recruiter: string
  replyTo: string
  company: string
  role: string
  location: string
  jobUrl: string
  reply: MailReply
  busy: boolean
  fetching: boolean
  composing: boolean
  sending: boolean
  hasImap: boolean
  attachPdf: boolean
  canAttach: boolean
  kitHint?: string
  onPasteChange: (value: string) => void
  onSelect: (id: string) => void
  onRecruiterChange: (value: string) => void
  onReplyToChange: (value: string) => void
  onCompanyChange: (value: string) => void
  onRoleChange: (value: string) => void
  onLocationChange: (value: string) => void
  onJobUrlChange: (value: string) => void
  onSubjectChange: (value: string) => void
  onBodyChange: (value: string) => void
  onParse: () => void
  onSample: () => void
  onFetch: () => void
  onImport: () => void
  onCompose: () => void
  onTailor: () => void
  onOpenMail: () => void
  onSend: () => void
  onAttachPdfChange: (value: boolean) => void
  onCopy: (kind: 'subject' | 'body') => void
  onOpenJob: () => void
  onOpenSettings: () => void
  onNewMail: () => void
  standalone: boolean
  onRevealPdf?: () => void
}

function sourceLabel(source: MailSource | string): string {
  return source || 'Mail'
}

export function MailPanel({
  paste,
  items,
  selectedId,
  recruiter,
  replyTo,
  company,
  role,
  location,
  jobUrl,
  reply,
  busy,
  fetching,
  composing,
  sending,
  hasImap,
  attachPdf,
  canAttach,
  kitHint,
  onPasteChange,
  onSelect,
  onRecruiterChange,
  onReplyToChange,
  onCompanyChange,
  onRoleChange,
  onLocationChange,
  onJobUrlChange,
  onSubjectChange,
  onBodyChange,
  onParse,
  onSample,
  onFetch,
  onImport,
  onCompose,
  onTailor,
  onOpenMail,
  onSend,
  onAttachPdfChange,
  onCopy,
  onOpenJob,
  onOpenSettings,
  onNewMail,
  standalone,
  onRevealPdf,
}: Props) {
  const selected = items.find((item) => item.id === selectedId) || null
  const composingOpen = standalone || Boolean(selected)
  const canReply = Boolean(reply.body.trim())
  const recipient = normalizeRecipient(replyTo)
  const canSend = canReply && Boolean(recipient) && hasImap && Boolean(reply.subject.trim())
  const sendLabel = standalone ? 'Send' : 'Send reply'

  return (
    <div className="ping-panel mail-panel">
      <p className="ping-lede">
        Source jobs from your mail inbox, or compose a standalone email. Fetch via IMAP, paste a
        recruiter message, or click New mail. Nothing goes out until you confirm Send.
      </p>

      <div className="ping-actions wrap">
        <button
          type="button"
          className="btn primary"
          disabled={busy || fetching || !hasImap}
          onClick={onFetch}
        >
          {fetching ? 'Fetching…' : 'Fetch inbox'}
        </button>
        <button type="button" className="btn ghost" disabled={busy || fetching} onClick={onImport}>
          Import .eml
        </button>
        <button type="button" className="btn ghost" onClick={onSample}>
          Load sample
        </button>
        <button
          type="button"
          className={`btn ghost${standalone ? ' mail-mode-active' : ''}`}
          onClick={onNewMail}
        >
          New mail
        </button>
        {!hasImap ? (
          <button type="button" className="btn ghost" onClick={onOpenSettings}>
            Connect IMAP
          </button>
        ) : null}
      </div>
      {!hasImap ? (
        <p className="ping-kit-hint">
          Fetch and Send need an app password in Settings. Paste or import still works offline.
        </p>
      ) : null}

      <label className="ping-label" htmlFor="mail-paste">
        Paste email or Gmail “show original”
      </label>
      <textarea
        id="mail-paste"
        placeholder="Paste a recruiter email, LinkedIn job alert, or .eml text…"
        value={paste}
        onChange={(e) => onPasteChange(e.target.value)}
        rows={5}
      />
      <div className="ping-actions">
        <button type="button" className="btn ghost" disabled={!paste.trim()} onClick={onParse}>
          Parse email
        </button>
      </div>

      {items.length === 0 && !standalone ? (
        <EmptyState
          icon={Mail}
          compact
          title="Jobs hide in your inbox"
          description="Fetch IMAP, import .eml files, or paste a message to shortlist roles. Or click New mail to send a standalone message."
        />
      ) : items.length > 0 ? (
        <div className="tracker-list mail-list">
          {items.map((item) => {
            const active = !standalone && item.id === selectedId
            return (
              <button
                key={item.id}
                type="button"
                className={`tracker-card mail-card ${active ? 'hunt-selected' : ''} ${item.alreadyTracked ? 'hunt-tracked' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                <div className="tracker-card-top">
                  <div>
                    <div className="tracker-company">{item.company || item.from || 'Unknown sender'}</div>
                    <div className="tracker-role">{item.role || item.subject || 'Untitled'}</div>
                  </div>
                  <span className="status-pill ready-to-apply">{item.score}</span>
                </div>
                <div className="tracker-meta">
                  <span>{sourceLabel(item.source)}</span>
                  {item.location ? <span>{item.location}</span> : null}
                  {item.alreadyTracked ? <span>tracked</span> : null}
                </div>
              </button>
            )
          })}
        </div>
      ) : null}

      {composingOpen ? (
        <>
          {standalone ? (
            <p className="ping-kit-hint">Standalone email — not tied to an inbox job.</p>
          ) : (
            <div className="ping-fields">
              <input
                placeholder="Recruiter"
                value={recruiter}
                onChange={(e) => onRecruiterChange(e.target.value)}
                aria-label="Recruiter name"
              />
              <input
                placeholder="Reply-To email"
                value={replyTo}
                onChange={(e) => onReplyToChange(e.target.value)}
                aria-label="Reply-to address"
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
          )}
          {selected && !standalone && selected.scoreReasons.length ? (
            <p className="ping-kit-hint">{selected.scoreReasons.join(' · ')}</p>
          ) : null}

          {standalone ? (
            <>
              <label className="ping-label" htmlFor="mail-to">
                To
              </label>
              <input
                id="mail-to"
                placeholder="recruiter@company.com"
                value={replyTo}
                onChange={(e) => onReplyToChange(e.target.value)}
                aria-label="To address"
              />
            </>
          ) : null}

          <label className="ping-label" htmlFor="mail-subject">
            {standalone ? 'Subject' : 'Reply subject'}
          </label>
          <input
            id="mail-subject"
            value={reply.subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            aria-label={standalone ? 'Subject' : 'Reply subject'}
          />
          <label className="ping-label" htmlFor="mail-body">
            {standalone ? 'Body' : 'Reply body'}
          </label>
          <textarea
            id="mail-body"
            value={reply.body}
            onChange={(e) => onBodyChange(e.target.value)}
            rows={standalone ? 10 : 7}
            placeholder={standalone ? 'Write the email…' : undefined}
          />

          <label className="check-row mail-attach">
            <input
              type="checkbox"
              checked={attachPdf && canAttach}
              disabled={!canAttach}
              onChange={(e) => onAttachPdfChange(e.target.checked)}
            />
            <span>
              {canAttach
                ? 'Attach resume.pdf from the apply kit'
                : 'Attach resume.pdf (build Tailor + kit first)'}
            </span>
          </label>

          <div className="ping-actions wrap">
            <button
              type="button"
              className="btn primary"
              disabled={busy || sending || !canSend}
              onClick={onSend}
            >
              {sending ? 'Sending…' : sendLabel}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy || !canReply}
              onClick={onOpenMail}
            >
              Open in mail app
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!reply.body.trim()}
              onClick={() => onCopy('body')}
            >
              Copy
            </button>
            {!standalone ? (
              <>
                <button type="button" className="btn ghost" disabled={!jobUrl.trim()} onClick={onOpenJob}>
                  Open listing
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
              </>
            ) : null}
            {onRevealPdf && kitHint ? (
              <button type="button" className="btn ghost" onClick={onRevealPdf}>
                Reveal PDF
              </button>
            ) : null}
          </div>
          {kitHint ? (
            <p className="ping-kit-hint">{kitHint}</p>
          ) : (
            <p className="ping-kit-hint">
              {sendLabel} uses SMTP from your account. Open in mail app is the mailto fallback.
              Nothing is sent until you confirm.
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
