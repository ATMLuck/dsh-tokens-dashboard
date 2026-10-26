import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { registerUsageCommand } from './command.ts'
import { Config, resolveDataDir, type PluginConfig } from './config.ts'
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
  const store: UsageStore = new UsageStore(join(dataDir, 'usage.jsonl'), onError)

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
  registerUsageCommand(ctx, store, {
    pricing: config.pricing,
    chartDays: config.chartDays,
    openAfterRender: config.openAfterRender,
    dataDir,
  })
}
