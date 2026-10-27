import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveDataDir, type PluginConfig } from './config.ts'
import { attachRecorder } from './recorder.ts'
import { registerUsageTool } from './tool.ts'
import { registerUsageRoutes, type WebServerLike } from './web-routes.ts'
import { UsageStore } from './usage-store.ts'

export { Config } from './config.ts'
export type { PluginConfig } from './config.ts'

export const name = 'tokens-dashboard'

/** Hard services: session events to record and the tool registry to publish into. */
export const inject = ['sessions', 'tools']

export function apply(ctx: Context, config: PluginConfig): void {
  const dataDir = resolveDataDir(config.dataDir)
  const store = new UsageStore(join(dataDir, 'usage.jsonl'), (error) => {
    console.error('[tokens-dashboard] usage store:', error)
  })

  // The store is an effect: loaded on activation, flushed and closed on
  // unload (including HMR), so the JSONL never keeps a dangling writer.
  ctx.effect(() => {
    void store.load()
    return () => {
      void store.close()
    }
  })

  attachRecorder(ctx, store)
  registerUsageTool(ctx, store, config.pricing)

  // Web profiles: serve the settings tab's data same-origin on the app's own
  // web server. ctx.inject keeps this child dormant in headless/sdk/acp
  // profiles (no webServer there) while recording and the tool keep working.
  ctx.inject(['webServer'], web => {
    const webServer = web.get('webServer') as WebServerLike | undefined
    if (webServer === undefined) return
    web.effect(() =>
      registerUsageRoutes(webServer, store, {
        pricing: config.pricing,
        chartDays: config.chartDays,
        onError: (error) => {
          console.error('[tokens-dashboard] data route:', error)
        },
      }),
    )
  })
}
