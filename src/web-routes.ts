import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildDashboardData } from './aggregate.ts'
import type { PricingMap } from './types.ts'
import type { UsageStore } from './usage-store.ts'

/**
 * Structural view of the harness `ctx.webServer` (GUI host browser carrier).
 * Kept structural so this module — and its tests — never import the
 * webserver package.
 */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export interface UsageRoutesOptions {
  pricing: PricingMap
  chartDays: number
  onError?: (error: unknown) => void
}

/** Same-origin JSON endpoint the settings tab fetches; exact route wins over
 * the Connection `/api` prefix and the SPA fallback. */
export const DATA_PATH = '/tokens-dashboard/data'

/** Clamp a `?days=` value into the supported chart window. */
export function parseDaysParam(raw: string | null, fallback: number): number {
  if (raw === null || !/^\d+$/.test(raw)) return fallback
  return Math.min(365, Math.max(1, Number.parseInt(raw, 10)))
}

/**
 * Register the usage data route on the web server. Every GET renders fresh
 * aggregates from the store, so the settings tab always reads live totals
 * (including today's). Returns the route disposer.
 */
export function registerUsageRoutes(
  webServer: WebServerLike,
  store: UsageStore,
  options: UsageRoutesOptions,
): () => void {
  return webServer.register({
    kind: 'exact',
    path: DATA_PATH,
    handler: (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const chartDays = parseDaysParam(url.searchParams.get('days'), options.chartDays)
        const data = buildDashboardData(store.all(), options.pricing, {
          chartDays,
          now: Date.now(),
        })
        const body = JSON.stringify(data)
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(body)
      } catch (error) {
        options.onError?.(error)
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        }
        res.end(JSON.stringify({ error: 'usage data render failed' }))
      }
    },
  })
}
