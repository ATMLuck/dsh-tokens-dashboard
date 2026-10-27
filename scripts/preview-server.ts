/**
 * Dev-only preview server: serves the standalone preview page plus the same
 * `/tokens-dashboard/data` routes the harness web server would provide, so
 * the real component's fetches and hover interactions work end to end.
 * Run: node scripts/preview-server.ts [port]
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDashboardData } from '../src/aggregate.ts'
import type { PricingMap, UsageRecord } from '../src/types.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number.parseInt(process.argv[2] ?? '8770', 10)

const DAY = 86_400_000
const now = new Date()
now.setHours(12, 0, 0, 0)
const nowTs = now.getTime()

function record(daysAgo: number, hour: number, model: string, input: number, output: number, cacheRead = 0): UsageRecord {
  return {
    ts: nowTs - daysAgo * DAY - (12 - hour) * 3_600_000,
    provider: 'deepseek',
    model,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

const records: UsageRecord[] = []
for (const [d, i, o, cr] of [
  [28, 400_000, 60_000, 150_000],
  [26, 700_000, 90_000, 300_000],
  [24, 250_000, 40_000, 80_000],
  [21, 900_000, 120_000, 400_000],
  [18, 500_000, 70_000, 200_000],
  [15, 1_200_000, 180_000, 500_000],
  [12, 800_000, 110_000, 350_000],
  [9, 300_000, 50_000, 100_000],
  [6, 1_500_000, 200_000, 600_000],
  [4, 600_000, 80_000, 250_000],
  [2, 450_000, 60_000, 180_000],
] as const) {
  records.push(record(d, 15, 'deepseek-chat', i, o, cr))
}
records.push(record(3, 14, 'deepseek-chat', 6_500_000, 900_000, 1_500_000))
for (const [d, i, o] of [
  [20, 300_000, 150_000],
  [10, 500_000, 250_000],
  [5, 200_000, 100_000],
  [1, 150_000, 90_000],
] as const) {
  records.push(record(d, 16, 'deepseek-reasoner', i, o))
}
records.push(record(0, 10, 'deepseek-chat', 300_000, 45_000, 120_000))
records.push(record(0, 11, 'deepseek-reasoner', 80_000, 50_000))

const pricing: PricingMap = {
  'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 2.19 },
}

function dataBody(url: string): { status: number; body: string } {
  const parsed = new URL(url, 'http://127.0.0.1')
  if (parsed.pathname !== '/tokens-dashboard/data') return { status: 404, body: 'not found' }
  const raw = parsed.searchParams.get('days') ?? '30'
  const days = /^\d+$/.test(raw) ? Math.min(365, Math.max(1, Number.parseInt(raw, 10))) : 30
  const data = buildDashboardData(records, pricing, { chartDays: days, now: nowTs })
  return { status: 200, body: JSON.stringify(data) }
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}

createServer((req: IncomingMessage, res: ServerResponse) => {
  const path = (req.url ?? '/').split('?')[0]
  if (path === '/tokens-dashboard/data') {
    const { status, body } = dataBody(req.url ?? '/')
    send(res, status, 'application/json; charset=utf-8', body)
    return
  }
  if (path === '/preview.js') {
    try {
      send(res, 200, 'text/javascript; charset=utf-8', readFileSync(join(root, 'preview', 'bundle.js'), 'utf8'))
    } catch {
      send(res, 404, 'text/plain; charset=utf-8', 'run scripts/build-preview.mjs first')
    }
    return
  }
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0;background:#0f1115;padding:20px"><div id="root"></div>' +
    '<script src="/preview.js"></script></body></html>'
  send(res, 200, 'text/html; charset=utf-8', html)
}).listen(port, '127.0.0.1', () => {
  console.log(`preview on http://127.0.0.1:${port}`)
})
