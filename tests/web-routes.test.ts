import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DATA_PATH, parseDaysParam, registerUsageRoutes } from '../src/web-routes.ts'
import { UsageStore } from '../src/usage-store.ts'

const NOON = new Date(2026, 9, 27, 12, 0, 0, 0).getTime()

function record(model: string, inputTokens: number) {
  return {
    ts: NOON,
    provider: 'deepseek',
    model,
    inputTokens,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

interface CapturedRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

function fakeRegistry(): { routes: CapturedRoute[]; webServer: Parameters<typeof registerUsageRoutes>[0] } {
  const routes: CapturedRoute[] = []
  const webServer = {
    register(route: CapturedRoute): () => void {
      routes.push(route)
      return () => {}
    },
  }
  return { routes, webServer }
}

function fakeReq(url: string): IncomingMessage {
  return { url, method: 'GET' } as unknown as IncomingMessage
}

interface FakeRes {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function fakeRes(): ServerResponse & FakeRes {
  const res = {
    statusCode: 0,
    headers: {},
    headersSent: false,
    body: '',
    writeHead(code: number, headers: Record<string, string>) {
      this.statusCode = code
      this.headers = headers
      this.headersSent = true
    },
    end(chunk?: string) {
      if (chunk !== undefined) this.body += chunk
    },
  }
  return res as unknown as ServerResponse & FakeRes
}

test('parseDaysParam clamps numeric input and falls back otherwise', () => {
  assert.equal(parseDaysParam(null, 30), 30)
  assert.equal(parseDaysParam('abc', 30), 30)
  assert.equal(parseDaysParam('7', 30), 7)
  assert.equal(parseDaysParam('0', 30), 1)
  assert.equal(parseDaysParam('400', 30), 365)
})

test('route serves fresh dashboard data as same-origin JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tokens-routes-'))
  const store = new UsageStore(join(dir, 'usage.jsonl'))
  try {
    store.record(record('deepseek-chat', 4321))
    const { routes, webServer } = fakeRegistry()
    const disposer = registerUsageRoutes(webServer, store, { pricing: {}, chartDays: 30 })
    assert.equal(routes.length, 1)
    const route = routes[0]
    assert.ok(route)
    assert.equal(route.kind, 'exact')
    assert.equal(route.path, DATA_PATH)

    const res = fakeRes()
    await route.handler(fakeReq(`${DATA_PATH}?days=7`), res)
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'] ?? '', /^application\/json/)
    assert.match(res.headers['cache-control'] ?? '', /no-store/)
    const data = JSON.parse(res.body)
    assert.equal(data.cards.length, 4)
    assert.equal(data.windowDaysCount, 7)
    assert.equal(data.lineDays.length, 7)
    assert.equal(data.lineModels[0]?.key, 'deepseek/deepseek-chat')
    assert.ok(data.generatedAt > 0)
    disposer()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('route falls back to the configured default window on a bad days param', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tokens-routes-'))
  const store = new UsageStore(join(dir, 'usage.jsonl'))
  try {
    const { routes, webServer } = fakeRegistry()
    registerUsageRoutes(webServer, store, { pricing: {}, chartDays: 14 })
    const route = routes[0]
    assert.ok(route)
    const res = fakeRes()
    await route.handler(fakeReq(`${DATA_PATH}?days=nope`), res)
    const data = JSON.parse(res.body)
    assert.equal(data.windowDaysCount, 14)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
