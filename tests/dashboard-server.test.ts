import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DashboardServer } from '../src/dashboard-server.ts'
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

test('server serves the live dashboard on loopback with a ?days override', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tokens-http-'))
  const store = new UsageStore(join(dir, 'usage.jsonl'))
  const server = new DashboardServer(store, { pricing: {}, chartDays: 30 })
  try {
    const beforeListen = server.url
    assert.equal(beforeListen, undefined)
    store.record(record('deepseek-chat', 4321))
    await server.listen()
    const url = server.url
    assert.ok(url !== undefined)
    assert.ok(url.startsWith('http://127.0.0.1:'))

    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
    assert.match(response.headers.get('cache-control') ?? '', /no-store/)
    const html = await response.text()
    assert.ok(html.startsWith('<!doctype html>'))
    assert.ok(html.includes('deepseek/deepseek-chat'))
    assert.ok(html.includes('<path d="'))

    const narrowed = await fetch(`${url}?days=5`)
    assert.ok((await narrowed.text()).includes('近 5 天'))

    const missing = await fetch(`${url}nope`)
    assert.equal(missing.status, 404)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('close stops the listener; url resets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tokens-http-'))
  const store = new UsageStore(join(dir, 'usage.jsonl'))
  const server = new DashboardServer(store, { pricing: {}, chartDays: 7 })
  try {
    await server.listen()
    const url = server.url
    assert.ok(url !== undefined)
    await server.close()
    assert.equal(server.url, undefined)
    await assert.rejects(fetch(url))
    // Double close is a no-op.
    await server.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
