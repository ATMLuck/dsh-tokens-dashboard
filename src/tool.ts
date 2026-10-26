import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isPeriod, summarizePeriod, type Period } from './aggregate.ts'
import { renderPeriodReport } from './report.ts'
import type { PricingMap } from './types.ts'
import type { UsageStore } from './usage-store.ts'

/**
 * Model-facing usage query. Returns the compact text report as the tool's
 * canonical string value so both the model and PTC mode read the same facts.
 */
export function registerUsageTool(
  ctx: Context,
  store: UsageStore,
  pricing: PricingMap,
): void {
  ctx.tools.register(
    defineTool({
      name: 'usage_report',
      description:
        'Summarize recorded model token usage: per-model and per-day totals for a period.',
      parameters: {
        period: {
          type: 'string',
          description: "Reporting window: 'today' | '7d' | '30d' | 'all' (default '30d')",
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const raw = args.period?.trim()
        let period: Period
        if (raw === undefined || raw.length === 0) {
          period = '30d'
        } else if (isPeriod(raw)) {
          period = raw
        } else {
          throw new Error(`未知 period：${raw}（可选 today / 7d / 30d / all）`)
        }
        const summary = summarizePeriod(store.all(), pricing, period)
        return renderPeriodReport(summary, { hasPricing: Object.keys(pricing).length > 0 })
      },
    }),
  )
}
