/**
 * Build the standalone preview bundle: the real UsageSection component plus
 * react, bundled into one file (unlike lib/client.js, which externalizes
 * react for the harness module table). Output is gitignored.
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = resolve(root, 'preview/bundle.js')

const result = await build({
  entryPoints: [resolve(root, 'src/preview.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: false,
  write: false,
  logLevel: 'info',
})

const body = result.outputFiles[0]?.text
if (body === undefined) throw new Error('esbuild produced no output')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, body, 'utf8')
console.log(`built ${outPath} (${body.length} bytes)`)
