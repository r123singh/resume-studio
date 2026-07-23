/// <reference types="vite/client" />

import { ResumeStudioApi } from '../electron/preload'

declare global {
  interface Window {
    resumeStudio: ResumeStudioApi
  }
}

declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const workerConstructor: {
    new (): Worker
  }
  export default workerConstructor
}

export {}
