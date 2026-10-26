import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { buildDashboardData } from './aggregate.ts'
import { renderDashboardHTML } from './dashboard.ts'
import type { PricingMap } from './types.ts'
import type { UsageStore } from './usage-store.ts'

export interface DashboardServerOptions {
  pricing: PricingMap
  chartDays: number
  /** Loopback port; 0 (default) picks a free one. */
  port?: number
  onError?: (error: unknown) => void
}

const ALLOWED_PATHS = new Set(['/', '/index.html', '/usage-dashboard.html'])

/**
 * Loopback-only HTTP server that renders the dashboard fresh on every GET.
 * Bound to 127.0.0.1 so the DSH right-sidebar `browser` pane (which accepts
 * loopback HTTP(S) targets) can embed the live view — no system browser and
 * no client-side plugin needed. Nothing listens on external interfaces.
 */
export class DashboardServer {
  private server: Server | undefined
  private boundUrl: string | undefined
  private readonly store: UsageStore
  private readonly options: DashboardServerOptions

  constructor(store: UsageStore, options: DashboardServerOptions) {
    this.store = store
    this.options = options
  }

  /** Root URL once listening; undefined before that. */
  get url(): string | undefined {
    return this.boundUrl
  }

  async listen(): Promise<void> {
    if (this.server !== undefined) return
    const server = createServer((request, response) => {
      void this.handle(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.options.port ?? 0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address !== null && typeof address === 'object') {
      this.boundUrl = `http://127.0.0.1:${address.port}/`
    }
    this.server = server
  }

  private render(requestUrl: string): { status: number; body: string } {
    const url = new URL(requestUrl, 'http://127.0.0.1')
    if (!ALLOWED_PATHS.has(url.pathname)) {
      return { status: 404, body: 'not found' }
    }
    let chartDays = this.options.chartDays
    const daysParam = url.searchParams.get('days')
    if (daysParam !== null && /^\d+$/.test(daysParam)) {
      chartDays = Math.min(365, Math.max(1, Number.parseInt(daysParam, 10)))
    }
    const data = buildDashboardData(this.store.all(), this.options.pricing, {
      chartDays,
      now: Date.now(),
    })
    return { status: 200, body: renderDashboardHTML(data) }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const { status, body } = this.render(request.url ?? '/')
      response.writeHead(status, {
        'content-type': status === 200 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(body)
    } catch (error) {
      this.options.onError?.(error)
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      }
      response.end('dashboard render failed')
    }
  }

  /** Stop listening; idempotent. In-flight responses are drained by close(). */
  async close(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    this.boundUrl = undefined
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error === undefined ? resolve() : reject(error)))
    })
  }
}
