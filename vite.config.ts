import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Strands and its provider SDKs are ESM-only; the main bundle is
              // CJS, so they stay external and load via dynamic import().
              external: [
                'electron',
                '@cursor/sdk',
                '@strands-agents/sdk',
                /^@strands-agents\/sdk\/.*/,
                '@aws-sdk/client-bedrock-runtime',
                '@anthropic-ai/sdk',
                '@google/genai',
                'openai',
                'zod',
              ],
              output: {
                format: 'cjs',
                entryFileNames: '[name].js',
              },
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', '@cursor/sdk'],
              output: {
                format: 'cjs',
                entryFileNames: '[name].js',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ['monaco-editor', '@monaco-editor/react'],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  base: './',
})
