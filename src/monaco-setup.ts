import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/min/vs/editor/editor.main.css'

// Bundle Monaco locally — CDN loads hang forever under Electron CSP / offline.
;(globalThis as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}

loader.config({ monaco })

/*
 * Editor themes derived from the app design tokens, so the canvas reads as part
 * of the product rather than an embedded IDE with its own palette.
 */
monaco.editor.defineTheme('resume-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'e6e8ec' },
    { token: 'keyword', foreground: 'a9bcff' },
    { token: 'string', foreground: '9ecbff' },
    { token: 'comment', foreground: '6f7681', fontStyle: 'italic' },
    { token: 'emphasis', foreground: 'e6e8ec' },
    { token: 'strong', foreground: 'e6e8ec' },
    { token: 'variable', foreground: 'e6e8ec' },
  ],
  colors: {
    'editor.background': '#0d0e11',
    'editor.foreground': '#e6e8ec',
    'editorLineNumber.foreground': '#464b55',
    'editorLineNumber.activeForeground': '#a0a6b0',
    'editor.selectionBackground': '#5b7cfa4d',
    'editor.inactiveSelectionBackground': '#5b7cfa26',
    'editor.lineHighlightBackground': '#16181d',
    'editorCursor.foreground': '#5b7cfa',
    'editorIndentGuide.background1': '#24272e',
    'editorWidget.background': '#191c21',
    'editorWidget.border': '#24272e',
    'editorGhostText.foreground': '#6f7681',
    'scrollbarSlider.background': '#32363f80',
  },
})

monaco.editor.defineTheme('resume-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '16181d' },
    { token: 'keyword', foreground: '3552cc' },
    { token: 'string', foreground: '0a6b53' },
    { token: 'comment', foreground: '868e99', fontStyle: 'italic' },
    { token: 'emphasis', foreground: '16181d' },
    { token: 'strong', foreground: '16181d' },
    { token: 'variable', foreground: '16181d' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#16181d',
    'editorLineNumber.foreground': '#b6bcc5',
    'editorLineNumber.activeForeground': '#5a616c',
    'editor.selectionBackground': '#4c6ef52e',
    'editor.lineHighlightBackground': '#f6f7f9',
    'editorCursor.foreground': '#4c6ef5',
    'editorIndentGuide.background1': '#e3e6ea',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#e3e6ea',
    'editorGhostText.foreground': '#868e99',
    'scrollbarSlider.background': '#cdd2d980',
  },
})
