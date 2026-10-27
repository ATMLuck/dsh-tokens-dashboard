import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aggregateDays,
  aggregateModels,
  aggregateWeeks,
  buildCards,
  buildDashboardData,
  buildHeatmap,
  cumulateDays,
  HEATMAP_DAYS,
  isPeriod,
  periodStartTs,
  recordCostUsd,
  recordsInPeriod,
  resolvePricing,
  summarizePeriod,
  weekAlignCells,
} from '../src/aggregate.ts'
import { dayKeyOf, lastDayKeys } from '../src/days.ts'
import type { UsageRecord } from '../src/types.ts'

/** Local noon on 2026-10-27 — timezones cannot move a local-noon timestamp across a day boundary. */
const NOON = new Date(2026, 9, 27, 12, 0, 0, 0).getTime()

function recordAt(ts: number, model: string, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    ts,
    provider: 'deepseek',
    model,
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 300,
    reasoningTokens: 100,
    ...overrides,
  }
}

test('dayKeyOf buckets by local calendar day', () => {
  const lateNight = new Date(2026, 9, 27, 23, 59).getTime()
  const earlyMorning = new Date(2026, 9, 27, 0, 1).getTime()
  assert.equal(dayKeyOf(lateNight), '2026-10-27')
  assert.equal(dayKeyOf(earlyMorning), '2026-10-27')
})

test('lastDayKeys returns ascending keys ending today', () => {
  const keys = lastDayKeys(3, NOON)
  assert.deepEqual(keys, ['2026-10-25', '2026-10-26', '2026-10-27'])
})

test('recordsInPeriod scopes by local-day boundaries', () => {
  const threeDaysAgo = new Date(2026, 9, 25, 9).getTime()
  const yesterday = new Date(2026, 9, 26, 9).getTime()
  const records = [recordAt(threeDaysAgo, 'a'), recordAt(yesterday, 'a'), recordAt(NOON, 'a')]
  assert.equal(recordsInPeriod(records, 'today', NOON).length, 1)
  assert.equal(recordsInPeriod(records, '7d', NOON).length, 3)
  assert.equal(recordsInPeriod(records, 'all', NOON).length, 3)
  const start = periodStartTs('today', NOON)
  assert.equal(start, new Date(2026, 9, 27, 0, 0, 0, 0).getTime())
})

test('aggregateModels sums disjoint fields per provider/model', () => {
  const models = aggregateModels(
    [recordAt(NOON, 'chat'), recordAt(NOON + 1, 'chat'), recordAt(NOON + 2, 'reasoner')],
    {},
  )
  assert.equal(models.length, 2)
  const chat = models.find(m => m.model === 'chat')
  assert.ok(chat)
  // 2 requests × (1000 + 200 + 300) billed input.
  assert.equal(chat.billedInputTokens, 3000)
  assert.equal(chat.outputTokens, 1000)
  assert.equal(chat.totalTokens, 4000)
  // reasoningTokens are informational and must not be double-counted.
  assert.equal(chat.requests, 2)
  assert.equal(models[0]?.key, 'deepseek/chat')
})

test('resolvePricing prefers exact match over longer-prefix fallback', () => {
  const pricing = {
    deepseek: { input: 1, output: 2 },
    'deepseek-chat': { input: 3, output: 4 },
  }
  assert.equal(resolvePricing(pricing, 'deepseek-chat')?.input, 3)
  assert.equal(resolvePricing(pricing, 'deepseek-chat-v3.2')?.input, 3)
  assert.equal(resolvePricing(pricing, 'deepseek-reasoner')?.input, 1)
  assert.equal(resolvePricing(pricing, 'other'), undefined)
})

test('recordCostUsd prices cache reads and writes separately', () => {
  const pricing = {
    chat: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 },
  }
  const cost = recordCostUsd(recordAt(NOON, 'chat'), pricing)
  // (1000×1 + 500×2 + 200×0.1 + 300×0.5) / 1e6
  assert.ok(Math.abs(cost - (1000 + 1000 + 20 + 150) / 1e6) < 1e-12)
  assert.equal(recordCostUsd(recordAt(NOON, 'unpriced'), pricing), 0)
})

test('summarizePeriod totals, per-model and per-day views agree', () => {
  const day1 = new Date(2026, 9, 26, 12).getTime()
  const records = [
    recordAt(day1, 'chat'),
    recordAt(day1 + 1, 'reasoner'),
    recordAt(NOON, 'chat'),
  ]
  const summary = summarizePeriod(records, {}, '7d', NOON)
  assert.equal(summary.totals.requests, 3)
  assert.equal(summary.totals.totalTokens, 3 * 2000)
  assert.equal(summary.days.length, 2)
  const day26 = summary.days.find(d => d.date === '2026-10-26')
  assert.ok(day26)
  assert.equal(day26.totals.totalTokens, 4000)
  assert.equal(day26.models.length, 2)
})

test('aggregateDays preserves zero days in the given window', () => {
  const days = aggregateDays([recordAt(NOON, 'chat')], {}, ['2026-10-25', '2026-10-26', '2026-10-27'])
  assert.equal(days.length, 3)
  assert.equal(days[0]?.totals.totalTokens, 0)
  assert.equal(days[2]?.totals.totalTokens, 2000)
})

test('buildCards covers the four dashboard windows', () => {
  const old = new Date(2025, 0, 1, 12).getTime()
  const cards = buildCards([recordAt(old, 'chat'), recordAt(NOON, 'chat')], {}, NOON)
  assert.deepEqual(cards.map(c => c.label), ['今日', '近7天', '近30天', '累计'])
  assert.equal(cards[0]?.tokens, 2000)
  assert.equal(cards[3]?.tokens, 4000)
  assert.equal(cards[3]?.requests, 2)
})

test('buildDashboardData aligns series arrays with day keys', () => {
  const day1 = new Date(2026, 9, 26, 12).getTime()
  const data = buildDashboardData(
    [recordAt(day1, 'chat'), recordAt(NOON, 'chat'), recordAt(NOON, 'reasoner')],
    {},
    { chartDays: 3, now: NOON },
  )
  assert.equal(data.lineDays.length, 3)
  assert.equal(data.lineDays[2], '2026-10-27')
  assert.deepEqual(
    data.lineModels.map(m => m.key),
    ['deepseek/chat', 'deepseek/reasoner'],
  )
  assert.equal(data.lineSeries.length, 2)
  // chat: [0, 2000, 2000], reasoner: [0, 0, 2000]
  assert.deepEqual(data.lineSeries[0], [0, 2000, 2000])
  assert.deepEqual(data.lineSeries[1], [0, 0, 2000])
  assert.equal(data.pie.length, 2)
})

test('isPeriod accepts only known windows', () => {
  assert.ok(isPeriod('today'))
  assert.ok(isPeriod('all'))
  assert.equal(isPeriod('yesterday'), false)
  assert.equal(isPeriod(42), false)
})

test('buildHeatmap keeps the trailing year with zero days preserved', () => {
  const day1 = new Date(2026, 9, 26, 12).getTime()
  const heatmap = buildHeatmap([recordAt(day1, 'chat'), recordAt(NOON, 'chat')], NOON)
  assert.equal(heatmap.length, HEATMAP_DAYS)
  assert.equal(heatmap[heatmap.length - 1]?.date, '2026-10-27')
  assert.equal(heatmap[heatmap.length - 1]?.tokens, 2000)
  assert.equal(heatmap[heatmap.length - 1]?.requests, 1)
  assert.equal(heatmap[heatmap.length - 2]?.tokens, 2000)
  // Days without records stay in the grid at zero.
  assert.equal(heatmap[0]?.tokens, 0)
  assert.equal(heatmap[0]?.date, '2025-10-29')
})

test('weekly, cumulative and aligned heatmap transforms', () => {
  // 2026-10-27 is a Tuesday; the week's Monday is 2026-10-26.
  const monday = new Date(2026, 9, 26, 12).getTime()
  const tuesday = new Date(2026, 9, 27, 12).getTime()
  const days = [
    { date: '2026-10-26', tokens: 100, requests: 1 },
    { date: '2026-10-27', tokens: 200, requests: 2 },
  ]
  const weeks = aggregateWeeks(days)
  assert.equal(weeks.length, 1)
  assert.equal(weeks[0]?.date, '2026-10-26')
  assert.equal(weeks[0]?.tokens, 300)
  assert.equal(weeks[0]?.requests, 3)

  const cum = cumulateDays(days)
  assert.deepEqual(cum.map(c => c.tokens), [100, 300])
  assert.deepEqual(cum.map(c => c.requests), [1, 3])

  // Starting on a Tuesday pads one null so the cell lands on row 1.
  const aligned = weekAlignCells([{ date: '2026-10-27', tokens: 200, requests: 2 }])
  assert.equal(aligned.length, 2)
  assert.equal(aligned[0], null)
  assert.equal(aligned[1]?.date, '2026-10-27')
  assert.equal(weekAlignCells([]).length, 0)

  // Sanity on the helper data used above.
  assert.equal(dayKeyOf(monday), '2026-10-26')
  assert.equal(dayKeyOf(tuesday), '2026-10-27')
})

test('buildDashboardData carries the heatmap window', () => {
  const data = buildDashboardData([recordAt(NOON, 'chat')], {}, { chartDays: 3, now: NOON })
  assert.equal(data.heatmap.length, HEATMAP_DAYS)
  assert.equal(data.heatmap[data.heatmap.length - 1]?.tokens, 2000)
})
