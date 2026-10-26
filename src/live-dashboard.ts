import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDashboardData } from './aggregate.ts'
import { renderDashboardHTML } from './dashboard.ts'
import type { PricingMap } from './types.ts'
import type { UsageStore } from './usage-store.ts'

export interface LiveDashboardOptions {
  dataDir: string
  pricing: PricingMap
  chartDays: number
  /** Trailing debounce for schedule(); defaults to 2s. */
  debounceMs?: number
  onError?: (error: unknown) => void
}

/**
 * Keeps `<dataDir>/usage-dashboard.html` current. Every recorded usage
 * schedules a debounced rebuild, so a browser polling the file always sees
 * fresh totals — including today's, as they land. Rebuilds serialize through
 * a queue and never run concurrently.
 */
export class LiveDashboard {
  readonly filePath: string
  private readonly store: UsageStore
  private readonly options: LiveDashboardOptions
  private readonly debounceMs: number
  private readonly onError: (error: unknown) => void
  private queue: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(store: UsageStore, options: LiveDashboardOptions) {
    this.store = store
    this.options = options
    this.debounceMs = options.debounceMs ?? 2000
    this.onError = options.onError ?? (() => {})
    this.filePath = join(options.dataDir, 'usage-dashboard.html')
  }

  /** Debounced rebuild after new usage lands; safe to call per record. */
  schedule(): void {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.rebuild().catch(this.onError)
    }, this.debounceMs)
  }

  /**
   * Immediate rebuild; resolves with the file path once written.
   * `chartDaysOverride` renders one-off windows (e.g. `/usage 14`) without
   * changing the scheduled default window.
   */
  async rebuild(now: number = Date.now(), chartDaysOverride?: number): Promise<string> {
    const run = async (): Promise<void> => {
      const data = buildDashboardData(this.store.all(), this.options.pricing, {
        chartDays: chartDaysOverride ?? this.options.chartDays,
        now,
      })
      await mkdir(this.options.dataDir, { recursive: true })
      await writeFile(this.filePath, renderDashboardHTML(data), 'utf8')
    }
    const tail = this.queue.then(run, run)
    this.queue = tail.then(
      () => {},
      () => {},
    )
    await tail
    return this.filePath
  }

  /** Resolve when every enqueued rebuild has settled. */
  async flush(): Promise<void> {
    await this.queue
  }

  /** Cancel a pending debounced rebuild; in-flight writes still finish. */
  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }
}
