import { useState } from 'react'

type ChatItem = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

type Props = {
  messages: ChatItem[]
  busy: boolean
  onTailor: (input: {
    company: string
    role: string
    location: string
    jobUrl: string
    jobDescription: string
  }) => Promise<void>
  onEdit: (instruction: string) => Promise<void>
}

export function ChatPanel({ messages, busy, onTailor, onEdit }: Props) {
  const [mode, setMode] = useState<'tailor' | 'edit'>('tailor')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [location, setLocation] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [jd, setJd] = useState('')
  const [instruction, setInstruction] = useState('')

  return (
    <aside className="chat-panel">
      <div className="pane-header">AI</div>
      <div className="mode-tabs">
        <button
          type="button"
          className={mode === 'tailor' ? 'tab active' : 'tab'}
          onClick={() => setMode('tailor')}
        >
          Tailor from JD
        </button>
        <button
          type="button"
          className={mode === 'edit' ? 'tab active' : 'tab'}
          onClick={() => setMode('edit')}
        >
          Edit open file
        </button>
      </div>

      <div className="chat-log">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
      </div>

      {mode === 'tailor' ? (
        <div className="chat-form">
          <div className="row-2">
            <input
              placeholder="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
            <input placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <div className="row-2">
            <input
              placeholder="Location (optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <input
              placeholder="Job URL (optional)"
              value={jobUrl}
              onChange={(e) => setJobUrl(e.target.value)}
            />
          </div>
          <textarea
            placeholder="Paste the full job description…"
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={8}
          />
          <button
            type="button"
            className="btn primary block"
            disabled={busy}
            onClick={() =>
              void onTailor({
                company,
                role,
                location,
                jobUrl,
                jobDescription: jd,
              })
            }
          >
            {busy ? 'Tailoring…' : 'Generate tailored resume'}
          </button>
        </div>
      ) : (
        <div className="chat-form">
          <textarea
            placeholder="e.g. Shorten the summary and emphasize AI governance…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={5}
          />
          <button
            type="button"
            className="btn primary block"
            disabled={busy}
            onClick={() => {
              const text = instruction
              setInstruction('')
              void onEdit(text)
            }}
          >
            {busy ? 'Editing…' : 'Apply AI edit'}
          </button>
        </div>
      )}
    </aside>
  )
}
