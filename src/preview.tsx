/**
 * Dev-only entry that mounts the real settings-page component standalone so
 * the hover interactions can be exercised in a browser without a running
 * harness. Built by scripts/build-preview.mjs (react bundled in); served by
 * scripts/preview-server.ts together with the same-origin data routes.
 */
import { createRoot } from 'react-dom/client'
import { UsageSection } from './client.tsx'

const rootEl = document.getElementById('root')
if (rootEl === null) throw new Error('missing #root mount element')
createRoot(rootEl).render(<UsageSection />)
