import { homedir } from 'node:os'
import Schema from '@deepseek-ai/schemastery'
import type { PricingMap } from './types.ts'

export interface PluginConfig {
  /** Directory for the usage log and the generated dashboard HTML. */
  dataDir?: string
  /** Trailing window of the dashboard line chart, in local days. */
  chartDays: number
  /** Open the generated dashboard in the browser after `/usage`. */
  openAfterRender: boolean
  /** USD per 1M tokens, keyed by exact model id or model id prefix. */
  pricing: PricingMap
}

export const Config: Schema<PluginConfig> = Schema.object({
  dataDir: Schema.string().default(''),
  chartDays: Schema.number().min(1).max(365).default(30),
  openAfterRender: Schema.boolean().default(true),
  pricing: Schema.dict(
    Schema.object({
      input: Schema.number().required(),
      output: Schema.number().required(),
      cacheRead: Schema.number(),
      cacheWrite: Schema.number(),
    }),
  ).default({}),
}) as unknown as Schema<PluginConfig>

/** Data dir precedence: config value → `$DSH_HOME` → `~/.dsh`. */
export function resolveDataDir(configured: string | undefined): string {
  const value = configured?.trim()
  if (value !== undefined && value.length > 0) return value
  const home = process.env.DSH_HOME?.trim()
  const base = home !== undefined && home.length > 0 ? home : homedir() + '/.dsh'
  return base + '/plugin-data/tokens-dashboard'
}
