/**
 * Bundles the Lambda into a single file.
 *
 * The AWS SDK is marked external because the Node 20 Lambda runtime ships v3,
 * which keeps the deployment package small and cold starts fast.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'dist-bundle')

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(outdir, 'index.mjs'),
  external: ['@aws-sdk/*'],
  minify: true,
  sourcemap: false,
  banner: {
    // esbuild's ESM output can reference these CJS builtins via shims.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
})

// Zipped via the platform's own archiver so the build needs no extra dependency.
const zipPath = join(outdir, 'function.zip')
if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${join(outdir, 'index.mjs')}' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' },
  )
} else {
  execFileSync('zip', ['-j', '-q', zipPath, join(outdir, 'index.mjs')], { stdio: 'inherit' })
}

console.log(`Bundled backend to ${zipPath}`)
