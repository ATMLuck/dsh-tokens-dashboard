import type { DashboardData } from './aggregate.ts'
import {
  colorFor,
  formatInt,
  formatTokens,
  formatUsd,
  renderDonutSVG,
  renderStackedAreaSVG,
} from './charts.ts'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: #0f1115; color: #e6e9f0;
    font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 0 0 12px; color: #aeb6c8; font-weight: 600; }
  .meta { color: #8b93a7; font-size: 12px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .card { background: #171a21; border: 1px solid #232833; border-radius: 10px; padding: 14px 16px; }
  .card-label { color: #8b93a7; font-size: 12px; margin-bottom: 6px; }
  .card-tokens { font-size: 24px; font-weight: 700; letter-spacing: 0.3px; }
  .card-sub { color: #8b93a7; font-size: 12px; margin-top: 6px; }
  .panel { background: #171a21; border: 1px solid #232833; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .donut-wrap { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  .legend { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  .legend-item { display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .legend-item .muted { color: #8b93a7; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: right; padding: 6px 10px; border-bottom: 1px solid #232833; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  th { color: #8b93a7; font-weight: 500; }
  td.model { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .empty { color: #8b93a7; padding: 32px 0; text-align: center; }
  footer { color: #5b6478; font-size: 11px; margin-top: 8px; }
  svg { max-width: 100%; height: auto; }
`

const RELOAD_SCRIPT = `
  // The plugin rewrites this file as new usage lands; re-render while the
  // tab is visible so today's totals stay live.
  setInterval(() => {
    if (!document.hidden) location.reload();
  }, 10000);
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
 * Render the standalone dashboard document: cards, a stacked daily-token
 * area chart, token/cost donuts and a per-model detail table. No external
 * assets and no JavaScript — the file opens anywhere.
 */
export function renderDashboardHTML(data: DashboardData): string {
  const generated = new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false })
  const hasModels = data.lineModels.length > 0

  const cards = data.cards.map(card => cardHtml(card, data.hasPricing)).join('')

  const lineChart = hasModels
    ? renderStackedAreaSVG({
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

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>模型用量仪表盘</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>模型用量仪表盘</h1>
  <div class="meta">生成于 ${escapeHtml(generated)} · 曲线窗口：近 ${data.windowDaysCount} 天${data.hasPricing ? '' : ' · 未配置定价，费用为 0'}</div>
</header>
<section class="cards">${cards}</section>
<div class="panel">
  <h2>每日 token 用量（按模型堆叠）</h2>
  <div class="donut-wrap" style="align-items:flex-start">${lineChart}${lineLegend}</div>
</div>
<div class="row">
  <div class="panel">
    <h2>模型占比 · tokens</h2>
    <div class="donut-wrap">${tokenDonut}${tokenLegend}</div>
  </div>
</div>
${costSection}
${tableSection}
<footer>数据来源：会话 assistant/message 的 usage 事件（dsh-tokens-dashboard 插件采集）；费用基于部署配置的定价估算，仅供参考。页面每 10 秒自动刷新（仅前台标签页），新用量由插件实时重写本文件。</footer>
<script>${RELOAD_SCRIPT}</script>
</body>
</html>
`
}
