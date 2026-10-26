import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { registerUsageCommand } from './command.ts'
import { Config, resolveDataDir, type PluginConfig } from './config.ts'
import { LiveDashboard } from './live-dashboard.ts'
import { attachRecorder } from './recorder.ts'
import { registerUsageTool } from './tool.ts'
import { UsageStore } from './usage-store.ts'

export { Config } from './config.ts'
export type { PluginConfig } from './config.ts'

export const name = 'tokens-dashboard'

/** Hard services: session events to record and the tool registry to publish into. */
export const inject = ['sessions', 'tools']

function reportError(context: string): (error: unknown) => void {
  return (error: unknown) => {
    console.error(`[tokens-dashboard] ${context}:`, error)
  }
}

export function apply(ctx: Context, config: PluginConfig): void {
  const onError = reportError('usage store')
  const dataDir = resolveDataDir(config.dataDir)
  const store = new UsageStore(join(dataDir, 'usage.jsonl'), onError)
  const dashboard = new LiveDashboard(store, {
    dataDir,
    pricing: config.pricing,
    chartDays: config.chartDays,
    onError: reportError('dashboard rebuild'),
  })

  // Store and dashboard are effects: loaded on activation, flushed and
  // closed on unload (including HMR), so no writer outlives the plugin.
  ctx.effect(() => {
    void store.load()
    return async () => {
      dashboard.dispose()
      await dashboard.flush().catch(onError)
      await store.close()
    }
  })

  // New usage lands in the JSONL and triggers a debounced dashboard rebuild,
  // so a browser polling the file always shows up-to-date totals.
  attachRecorder(ctx, store, () => dashboard.schedule())
  registerUsageTool(ctx, store, config.pricing)
  registerUsageCommand(ctx, store, {
    pricing: config.pricing,
    openAfterRender: config.openAfterRender,
    dashboard,
  })
}
