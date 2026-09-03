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
 * Workbench colors aligned with Cursor Dark / Light so the editor canvas
 * does not sit on a different palette from the chrome.
 */
monaco.editor.defineTheme('resume-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4' },
    { token: 'keyword', foreground: '569cd6' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'emphasis', foreground: 'd4d4d4' },
    { token: 'strong', foreground: 'd4d4d4' },
    { token: 'variable', foreground: 'd4d4d4' },
  ],
  colors: {
    'editor.background': '#181818',
    'editor.foreground': '#d4d4d4',
    'editorLineNumber.foreground': '#6e7681',
    'editorLineNumber.activeForeground': '#cccccc',
    'editor.selectionBackground': '#264f78',
    'editor.inactiveSelectionBackground': '#264f7855',
    'editor.lineHighlightBackground': '#ffffff0a',
    'editorCursor.foreground': '#aeafad',
    'editorIndentGuide.background1': '#2b2b2b',
    'editorIndentGuide.activeBackground1': '#3c3c3c',
    'editorWidget.background': '#1f1f1f',
    'editorWidget.border': '#2b2b2b',
    'editorGhostText.foreground': '#6e6e6e',
    'editorGutter.background': '#181818',
    'scrollbarSlider.background': '#3c3c3c66',
    'scrollbarSlider.hoverBackground': '#3c3c3c99',
    'minimap.background': '#181818',
  },
})

monaco.editor.defineTheme('resume-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '3b3b3b' },
    { token: 'keyword', foreground: '0000ff' },
    { token: 'string', foreground: 'a31515' },
    { token: 'comment', foreground: '008000', fontStyle: 'italic' },
    { token: 'emphasis', foreground: '3b3b3b' },
    { token: 'strong', foreground: '3b3b3b' },
    { token: 'variable', foreground: '3b3b3b' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#3b3b3b',
    'editorLineNumber.foreground': '#237893',
    'editorLineNumber.activeForeground': '#0b216f',
    'editor.selectionBackground': '#add6ff',
    'editor.lineHighlightBackground': '#ffffff00',
    'editor.lineHighlightBorder': '#eeeeee',
    'editorCursor.foreground': '#000000',
    'editorIndentGuide.background1': '#d3d3d3',
    'editorWidget.background': '#f3f3f3',
    'editorWidget.border': '#cecece',
    'editorGhostText.foreground': '#8b8b8b',
    'editorGutter.background': '#ffffff',
    'scrollbarSlider.background': '#64646433',
  },
})
