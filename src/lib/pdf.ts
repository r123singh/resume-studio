import { marked } from 'marked'

export function markdownToPrintHtml(markdown: string, title: string): string {
  const body = marked.parse(markdown, { async: false }) as string
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 16mm; }
    body {
      font-family: "Segoe UI", Georgia, serif;
      color: #111;
      font-size: 11pt;
      line-height: 1.45;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { font-size: 20pt; margin: 0 0 8px; }
    h2 { font-size: 13pt; margin: 18px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    h3, h4 { font-size: 11.5pt; margin: 12px 0 4px; }
    p, li { margin: 4px 0; }
    ul { padding-left: 1.2em; }
    a { color: #111; text-decoration: none; }
    hr { border: none; border-top: 1px solid #ddd; margin: 16px 0; }
    code { font-family: Consolas, monospace; font-size: 10pt; }
  </style>
</head>
<body>${body}</body>
</html>`
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
