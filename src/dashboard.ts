import type { DashboardData } from './aggregate.ts'
import {
  colorFor,
  formatInt,
  formatTokens,
  formatUsd,
  renderDonutSVG,
  renderSmoothLineSVG,
} from './charts.ts'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * All rules are scoped under `.td-dashboard` so the fragment stays inert
 * inside the settings page (host app styles are never touched).
 */
const STYLE = `
.td-dashboard { color: #e6e9f0; font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px; }
.td-dashboard * { box-sizing: border-box; }
.td-dashboard .meta { color: #8b93a7; font-size: 12px; margin-bottom: 16px; }
.td-dashboard h2 { font-size: 14px; margin: 0 0 12px; color: #aeb6c8; font-weight: 600; }
.td-dashboard .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
.td-dashboard .card { background: #171a21; border: 1px solid #232833; border-radius: 10px; padding: 14px 16px; }
.td-dashboard .card-label { color: #8b93a7; font-size: 12px; margin-bottom: 6px; }
.td-dashboard .card-tokens { font-size: 24px; font-weight: 700; letter-spacing: 0.3px; }
.td-dashboard .card-sub { color: #8b93a7; font-size: 12px; margin-top: 6px; }
.td-dashboard .panel { background: #171a21; border: 1px solid #232833; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.td-dashboard .donut-wrap { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.td-dashboard .legend { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.td-dashboard .legend-item { display: flex; align-items: center; gap: 8px; }
.td-dashboard .dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.td-dashboard .legend-item .muted { color: #8b93a7; }
.td-dashboard table { width: 100%; border-collapse: collapse; font-size: 13px; }
.td-dashboard th, .td-dashboard td { text-align: right; padding: 6px 10px; border-bottom: 1px solid #232833; white-space: nowrap; }
.td-dashboard th:first-child, .td-dashboard td:first-child { text-align: left; }
.td-dashboard th { color: #8b93a7; font-weight: 500; }
.td-dashboard td.model { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.td-dashboard .empty { color: #8b93a7; padding: 32px 0; text-align: center; }
.td-dashboard footer { color: #5b6478; font-size: 11px; margin-top: 8px; }
.td-dashboard svg { max-width: 100%; height: auto; }
`

function cardHtml(card: DashboardData['cards'][number], hasPricing: boolean): string {
  const cost =
    hasPricing && card.costUsd > 0
      ? ` · ${escapeHtml(formatUsd(card.costUsd))}`
      : ''
  return (
    `<div class="card"><div class="card-label">${escapeHtml(card.label)}</div>` +
    `<div class="card-tokens">${escapeHtml(formatTokens(card.tokens))}</div>` +
    `<div class="card-sub">请求 ${escapeHtml(formatInt(card.requests))}${cost}</div></div>`
  )
}

function legendHtml(
  entries: readonly { label: string; detail: string }[],
): string {
  const items = entries
    .map(
      (entry, index) =>
        `<div class="legend-item"><span class="dot" style="background:${colorFor(index)}"></span>` +
        `<span>${escapeHtml(entry.label)}</span>` +
        `<span class="muted">${escapeHtml(entry.detail)}</span></div>`,
    )
    .join('')
  return `<div class="legend">${items}</div>`
}

/**
 * Render the dashboard as a scoped HTML fragment (style + one wrapper div).
 * Shared by the Web Client settings tab; contains no scripts — the host app
 * owns when to re-fetch and re-render.
 */
export function renderDashboardBody(data: DashboardData): string {
  const generated = new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false })
  const hasModels = data.lineModels.length > 0

  const cards = data.cards.map(card => cardHtml(card, data.hasPricing)).join('')

  const lineChart = hasModels
    ? renderSmoothLineSVG({
        days: data.lineDays,
        series: data.lineModels.map((model, index) => ({
          label: model.key,
          values: data.lineSeries[index] ?? [],
        })),
      })
    : `<div class="empty">所选窗口内暂无模型用量数据</div>`

  const lineLegend = hasModels
    ? legendHtml(
        data.lineModels.map(model => ({
          label: model.key,
          detail: `${formatTokens(model.totalTokens)} · ${formatInt(model.requests)} 次`,
        })),
      )
    : ''

  const tokenDonut = renderDonutSVG({
    items: data.pie.map(model => ({ label: model.key, value: model.totalTokens })),
  })
  const tokenLegend = legendHtml(
    data.pie.map(model => ({
      label: model.key,
      detail: `${formatTokens(model.totalTokens)}`,
    })),
  )

  const costTotal = data.pie.reduce((sum, model) => sum + model.costUsd, 0)
  const costSection =
    data.hasPricing && costTotal > 0
      ? `<div class="panel"><h2>模型占比 · 费用（估算）</h2><div class="donut-wrap">` +
        renderDonutSVG({
          items: data.pie.map(model => ({ label: model.key, value: model.costUsd })),
        }) +
        legendHtml(
          data.pie.map(model => ({
            label: model.key,
            detail: formatUsd(model.costUsd),
          })),
        ) +
        `</div></div>`
      : ''

  const tableRows = data.table
    .map(
      model =>
        `<tr><td class="model">${escapeHtml(model.key)}</td>` +
        `<td>${escapeHtml(formatInt(model.requests))}</td>` +
        `<td>${escapeHtml(formatTokens(model.inputTokens))}</td>` +
        `<td>${escapeHtml(formatTokens(model.outputTokens))}</td>` +
        `<td>${escapeHtml(formatTokens(model.cacheReadTokens))}</td>` +
        `<td>${escapeHtml(formatTokens(model.cacheWriteTokens))}</td>` +
        `<td>${escapeHtml(formatTokens(model.totalTokens))}</td>` +
        `<td>${data.hasPricing ? escapeHtml(formatUsd(model.costUsd)) : '—'}</td></tr>`,
    )
    .join('')

  const tableSection = hasModels
    ? `<div class="panel"><h2>模型明细（近 ${data.windowDaysCount} 天）</h2>` +
      `<table><thead><tr><th>模型</th><th>请求</th><th>输入(未缓存)</th><th>输出</th>` +
      `<th>缓存读</th><th>缓存写</th><th>合计</th><th>费用</th></tr></thead>` +
      `<tbody>${tableRows}</tbody></table></div>`
    : ''

  return (
    `<style>${STYLE}</style>` +
    `<div class="td-dashboard">` +
    `<div class="meta">数据更新于 ${escapeHtml(generated)}${data.hasPricing ? '' : ' · 未配置定价，费用为 0'}</div>` +
    `<section class="cards">${cards}</section>` +
    `<div class="panel td-linepanel"><h2>每日 token 用量（按模型）</h2>` +
    `<div class="donut-wrap" style="align-items:flex-start">${lineChart}${lineLegend}</div></div>` +
    `<div class="panel"><h2>模型占比 · tokens</h2><div class="donut-wrap">${tokenDonut}${tokenLegend}</div></div>` +
    costSection +
    tableSection +
    `<footer>数据来源：会话 assistant/message 的 usage 事件（dsh-tokens-dashboard 插件采集）；费用基于部署配置的定价估算，仅供参考。</footer>` +
    `</div>`
  )
}
