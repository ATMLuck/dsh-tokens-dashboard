import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { isPeriod, summarizePeriod } from './aggregate.ts'
import type { DashboardServer } from './dashboard-server.ts'
import type { LiveDashboard } from './live-dashboard.ts'
import { renderPeriodReport } from './report.ts'
import type { PricingMap } from './types.ts'
import type { UsageStore } from './usage-store.ts'

/** Minimal structural view of the harness command registry (`ctx.commands`). */
interface CommandsRuntimeLike {
  register(definition: {
    name: string
    description: string
    handler: (invocation: { rawInput: string }) =>
      | { kind: 'success'; text?: string }
      | { kind: 'error'; text: string }
      | Promise<{ kind: 'success'; text?: string } | { kind: 'error'; text: string }>
  }): () => void
}

function openInBrowser(path: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', path], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [path], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [path], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    // Best effort: the command still reports the dashboard path.
  }
}

const HELP_TEXT = [
  '/usage — 打开模型用量仪表盘（卡片、曲线图与饼图，实时刷新）',
  '/usage <窗口> — 窗口可选 today / 7d / 30d / all，或天数（如 /usage 14）',
  '链接在 DSH 内置预览（右侧栏 browser 窗格）中打开；聊天链接偏好指向系统浏览器时也可在设置中改回。',
].join('\n')

export interface CommandOptions {
  pricing: PricingMap
  openAfterRender: boolean
  dashboard: LiveDashboard
  server: DashboardServer
}

/**
 * Register the `/usage` human command. `commands` is an optional dependency:
 * when the profile provides none, this is a no-op and the tool plus the
 * recorder keep working.
 */
export function registerUsageCommand(
  ctx: Context,
  store: UsageStore,
  options: CommandOptions,
): void {
  const commands = ctx.get('commands') as CommandsRuntimeLike | undefined
  if (commands === undefined) {
    console.log('[tokens-dashboard] no commands runtime in this profile; /usage disabled')
    return
  }
  commands.register({
    name: 'usage',
    description: '模型用量仪表盘：卡片、曲线图与饼图（DSH 内置预览，实时刷新）',
    handler: async ({ rawInput }) => {
      const input = rawInput.trim()
      if (input === 'help' || input === '-h') {
        return { kind: 'success', text: HELP_TEXT }
      }
      let chartDays: number | undefined
      if (input.length > 0 && /^\d+$/.test(input)) {
        chartDays = Math.min(365, Math.max(1, Number.parseInt(input, 10)))
      } else if (input.length > 0 && !isPeriod(input)) {
        return { kind: 'error', text: `未知窗口：${input}（可选 today / 7d / 30d / all 或天数）` }
      }
      const now = Date.now()
      const lines: string[] = []
      // Live view for the DSH sidebar browser pane (loopback URL).
      const liveUrl = options.server.url
      if (liveUrl !== undefined) {
        const target = chartDays === undefined ? liveUrl : `${liveUrl}?days=${chartDays}`
        lines.push(`实时仪表盘：[${target}](${target})`)
      }
      // File snapshot with the same window.
      let outPath: string | undefined
      try {
        outPath = await options.dashboard.rebuild(now, chartDays)
      } catch (error) {
        return { kind: 'error', text: `仪表盘生成失败：${String(error)}` }
      }
      if (outPath !== undefined) lines.push(`静态快照：${outPath}`)
      if (options.openAfterRender && outPath !== undefined) openInBrowser(outPath)
      const period = isPeriod(input) ? input : '30d'
      const summary = summarizePeriod(store.all(), options.pricing, period, now)
      const report = renderPeriodReport(summary, {
        hasPricing: Object.keys(options.pricing).length > 0,
      })
      lines.push('', report)
      return { kind: 'success', text: lines.join('\n') }
    },
  })
}
