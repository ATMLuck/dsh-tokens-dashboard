import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  colorFor,
  formatInt,
  formatTokens,
  formatUsd,
  renderDonutSVG,
  renderStackedAreaSVG,
} from '../src/charts.ts'
import { renderDashboardBody } from '../src/dashboard.ts'
import { buildDashboardData } from '../src/aggregate.ts'

const NOON = new Date(2026, 9, 27, 12, 0, 0, 0).getTime()

test('number formatters stay human readable', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(1234), '1.2K')
  assert.equal(formatTokens(4_500_000), '4.50M')
  assert.equal(formatTokens(2_300_000_000), '2.30B')
  assert.equal(formatUsd(0), '$0')
  assert.equal(formatUsd(0.5), '$0.5000')
  assert.equal(formatUsd(12.345), '$12.35')
  assert.equal(formatInt(1234567), '1,234,567')
})

test('colorFor cycles the palette deterministically', () => {
  assert.equal(colorFor(0), colorFor(10))
  assert.notEqual(colorFor(0), colorFor(1))
})

test('stacked area chart renders valid paths and per-day markers', () => {
  const svg = renderStackedAreaSVG({
    days: ['2026-10-25', '2026-10-26', '2026-10-27'],
    series: [
      { label: 'a', values: [1, 2, 3] },
      { label: 'b', values: [0, 1, 0] },
    ],
  })
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.endsWith('</svg>'))
  // Areas must be <path d> — <polygon points> cannot carry M/L grammar and
  // browsers drop the whole shape (regression guard).
  assert.equal((svg.match(/<path d="/g) ?? []).length, 2)
  assert.ok(!svg.includes('<polygon'))
  // One marker per non-zero day: a=[1,2,3] → 3, b=[0,1,0] → 1.
  assert.equal((svg.match(/<circle /g) ?? []).length, 4)
  // Today (last day) is emphasized with the larger radius.
  assert.ok(svg.includes('r="3.5"'))
  assert.ok(svg.includes('2026-10-27'))
})

test('single-day windows render stacked bars instead of degenerate areas', () => {
  const svg = renderStackedAreaSVG({
    days: ['2026-10-27'],
    series: [{ label: 'a', values: [5] }],
  })
  assert.ok(svg.includes('<rect'))
  assert.ok(!svg.includes('<polygon'))
  assert.ok(!svg.includes('<path d="'))
})

test('donut renders slices and a centered total; empty input renders placeholder', () => {
  const donut = renderDonutSVG({
    items: [
      { label: 'a', value: 3 },
      { label: 'b', value: 1 },
    ],
  })
  assert.equal((donut.match(/<path /g) ?? []).length, 2)
  assert.ok(donut.includes('4</text>')) // centered total via formatTokens
  const empty = renderDonutSVG({ items: [] })
  assert.ok(empty.includes('暂无数据'))
  const allZero = renderDonutSVG({ items: [{ label: 'a', value: 0 }] })
  assert.ok(allZero.includes('暂无数据'))
})

test('dashboard body embeds scoped styles, charts and the model table', () => {
  const record = {
    ts: NOON,
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 300,
    reasoningTokens: 0,
  }
  const data = buildDashboardData([record], { 'deepseek-chat': { input: 1, output: 2 } }, {
    chartDays: 3,
    now: NOON,
  })
  const html = renderDashboardBody(data)
  assert.ok(html.startsWith('<style>'))
  assert.ok(html.includes('class="td-dashboard"'))
  assert.ok(html.includes('今日'))
  assert.ok(html.includes('每日 token 用量'))
  assert.ok(html.includes('模型占比 · tokens'))
  assert.ok(html.includes('模型占比 · 费用'))
  assert.ok(html.includes('deepseek/deepseek-chat'))
  assert.ok(html.includes('近 3 天'))
  // The host app owns re-rendering; the fragment must stay script-free.
  assert.ok(!html.includes('<script'))
  // Model ids are HTML-escaped if they ever contain markup.
  const sneaky = buildDashboardData(
    [{ ...record, provider: '<img>', model: 'x"onerror' }],
    {},
    { chartDays: 1, now: NOON },
  )
  const sneakyHtml = renderDashboardBody(sneaky)
  assert.ok(!sneakyHtml.includes('<img>'))
  assert.ok(sneakyHtml.includes('&lt;img&gt;'))
})
