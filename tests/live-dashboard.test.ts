import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LiveDashboard } from '../src/live-dashboard.ts'
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

async function withTempStore(run: (store: UsageStore, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tokens-live-'))
  const store = new UsageStore(join(dir, 'usage.jsonl'))
  try {
    await run(store, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('rebuild writes a dashboard reflecting current records', async () => {
  await withTempStore(async (store, dir) => {
    store.record(record('deepseek-chat', 1234))
    const dashboard = new LiveDashboard(store, {
      dataDir: dir,
      pricing: {},
      chartDays: 3,
    })
    const outPath = await dashboard.rebuild(NOON)
    assert.equal(outPath, join(dir, 'usage-dashboard.html'))
    const html = await readFile(outPath, 'utf8')
    assert.ok(html.startsWith('<!doctype html>'))
    assert.ok(html.includes('deepseek/deepseek-chat'))
    assert.ok(html.includes('location.reload'))
  })
})

test('rebuild honours a one-off chartDays override without touching the default', async () => {
  await withTempStore(async (store, dir) => {
    const dashboard = new LiveDashboard(store, {
      dataDir: dir,
      pricing: {},
      chartDays: 30,
    })
    await dashboard.rebuild(NOON, 5)
    const html = await readFile(join(dir, 'usage-dashboard.html'), 'utf8')
    assert.ok(html.includes('近 5 天'))
    assert.ok(!html.includes('近 30 天'))
  })
})

test('schedule() debounces trailing rebuilds and dispose cancels them', async () => {
  await withTempStore(async (store, dir) => {
    const dashboard = new LiveDashboard(store, {
      dataDir: dir,
      pricing: {},
      chartDays: 2,
      debounceMs: 10,
    })
    // Nothing written before the debounce elapses.
    dashboard.schedule()
    await assert.rejects(stat(join(dir, 'usage-dashboard.html')))
    // Trailing single write after the window.
    dashboard.schedule()
    await delay(40)
    await dashboard.flush()
    await assert.doesNotReject(stat(join(dir, 'usage-dashboard.html')))
    const before = await readFile(join(dir, 'usage-dashboard.html'), 'utf8')
    // New record lands, schedule re-renders it.
    store.record(record('deepseek-reasoner', 500))
    dashboard.schedule()
    await delay(40)
    await dashboard.flush()
    const after = await readFile(join(dir, 'usage-dashboard.html'), 'utf8')
    assert.ok(after.includes('deepseek/deepseek-reasoner'))
    assert.ok(!before.includes('deepseek/deepseek-reasoner'))
    // Dispose cancels pending schedules.
    store.record(record('deepseek-chat', 1))
    dashboard.dispose()
    dashboard.schedule()
    dashboard.dispose()
    await delay(40)
    await dashboard.flush()
    const finalHtml = await readFile(join(dir, 'usage-dashboard.html'), 'utf8')
    assert.ok(!finalHtml.includes('deepseek/deepseek-chat'))
  })
})
