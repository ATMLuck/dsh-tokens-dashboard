import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  normalizeObservation,
  parseUsageJsonl,
  serializeRecord,
  UsageStore,
} from '../src/usage-store.ts'

const NOON = new Date(2026, 9, 27, 12, 0, 0, 0).getTime()

function observation(overrides: Record<string, unknown> = {}) {
  return {
    ts: NOON,
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { inputTokens: 10, outputTokens: 5 },
    ...overrides,
  }
}

test('normalizeObservation drops observations without attribution or usage', () => {
  assert.ok(normalizeObservation(observation()))
  assert.equal(normalizeObservation(observation({ usage: undefined })), null)
  assert.equal(normalizeObservation(observation({ model: '' })), null)
  assert.equal(normalizeObservation(observation({ provider: '' })), null)
  assert.equal(normalizeObservation(observation({ ts: -1 })), null)
  assert.equal(normalizeObservation(observation({ usage: {} })), null)
  const normalized = normalizeObservation(
    observation({ usage: { inputTokens: 10, reasoningTokens: 7 } }),
  )
  assert.ok(normalized)
  assert.deepEqual(normalized, {
    ts: NOON,
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 10,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 7,
  })
})

test('JSONL round-trip skips malformed lines', () => {
  const record = normalizeObservation(observation())
  assert.ok(record)
  const text = [serializeRecord(record), 'not json', '{"ts":1}', '', serializeRecord(record)].join('\n')
  const parsed = parseUsageJsonl(text)
  assert.equal(parsed.records.length, 2)
  assert.equal(parsed.badLines, 2)
  assert.deepEqual(parsed.records[0], record)
})

test('UsageStore appends records and reloads them from disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tokens-'))
  const filePath = join(dir, 'usage.jsonl')
  try {
    const store = new UsageStore(filePath)
    await store.load()
    const first = normalizeObservation(observation())
    const second = normalizeObservation(observation({ model: 'deepseek-reasoner', usage: { outputTokens: 9 } }))
    assert.ok(first && second)
    store.record(first)
    store.record(second)
    await store.flush()
    assert.equal(store.size, 2)

    const reloaded = new UsageStore(filePath)
    await reloaded.load()
    assert.equal(reloaded.size, 2)
    assert.deepEqual(reloaded.all()[1], second)

    const raw = await readFile(filePath, 'utf8')
    assert.equal(raw.trim().split('\n').length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('UsageStore tolerates a missing file and reports bad lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tokens-'))
  const filePath = join(dir, 'usage.jsonl')
  try {
    const store = new UsageStore(filePath)
    await store.load()
    assert.equal(store.size, 0)

    const errors: unknown[] = []
    const bad = new UsageStore(filePath, error => errors.push(error))
    await bad.load()
    assert.equal(errors.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('close stops accepting further records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tokens-'))
  const filePath = join(dir, 'usage.jsonl')
  try {
    const store = new UsageStore(filePath)
    const record = normalizeObservation(observation())
    assert.ok(record)
    store.record(record)
    await store.close()
    store.record(record)
    await store.flush()
    assert.equal(store.size, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
