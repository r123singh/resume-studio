import './monaco-setup'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

const ua = navigator.userAgent
document.documentElement.dataset.platform = /Mac/i.test(ua)
  ? 'darwin'
  : /Linux/i.test(ua)
    ? 'linux'
    : 'win'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
