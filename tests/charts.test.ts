import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  colorFor,
  formatInt,
  formatTokens,
  formatUsd,
  renderDonutSVG,
  renderSmoothLineSVG,
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

test('smooth curve chart renders one monotone curve per series', () => {
  const svg = renderSmoothLineSVG({
    days: ['2026-10-25', '2026-10-26', '2026-10-27'],
    series: [
      { label: 'a', values: [1, 2, 3] },
      { label: 'b', values: [0, 1, 0] },
    ],
  })
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.endsWith('</svg>'))
  // Per series: one faint under-fill path + one stroked curve.
  assert.equal((svg.match(/fill-opacity="0.12"/g) ?? []).length, 2)
  assert.equal((svg.match(/fill="none" stroke="/g) ?? []).length, 2)
  // Cubic segments — the curve is actually smooth, not a polyline.
  assert.ok(svg.includes(' C '))
  // Usage dots on non-zero days only: a has 3, b has 1; today emphasized.
  assert.equal((svg.match(/<circle /g) ?? []).length, 4)
  assert.ok(svg.includes('r="3"'))
  assert.ok(svg.includes('10-27'))
})

test('single-point windows render a lone emphasized dot', () => {
  const svg = renderSmoothLineSVG({
    days: ['2026-10-27'],
    series: [{ label: 'a', values: [5] }],
  })
  // A single point has no curve; the dot carries the value.
  assert.ok(!svg.includes('<path d="'))
  assert.equal((svg.match(/<circle /g) ?? []).length, 1)
  assert.ok(svg.includes('r="3"'))
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
