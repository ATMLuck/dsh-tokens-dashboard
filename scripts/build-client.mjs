/**
 * Build the browser half of the plugin into lib/client.js.
 *
 * The harness client-module system expects a lazy-CJS factory artifact: the
 * script registers `{ id, factory }` on `window.__ModuleLoader__`; running
 * the bundle only registers the factory, and the module body materializes on
 * first import with the loader's `require` resolving the frozen platform
 * module table (react, cordis, client runtime packages). The official tsdown
 * preset is not published, so this script replicates the format with esbuild.
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = resolve(root, 'lib/client.js')

/** Platform modules the shell shares into the frozen module table. */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const result = await build({
  entryPoints: [resolve(root, 'src/client.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_EXTERNALS,
  minify: true,
  write: false,
  logLevel: 'info',
})

const body = result.outputFiles[0]?.text
if (body === undefined) throw new Error('esbuild produced no output')

const artifact = [
  'window.__ModuleLoader__.load({',
  '  id: "dsh-tokens-dashboard",',
  '  factory: (require) => {',
  '    const module = { exports: {} };',
  '    const exports = module.exports;',
  body,
  '    return module.exports;',
  '  },',
  '});',
  '',
].join('\n')

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, artifact, 'utf8')
console.log(`built ${outPath} (${artifact.length} bytes)`)
