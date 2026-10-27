/**
 * Browser half of the plugin: a dedicated「模型用量」page in the DSH
 * settings panel. Registered into the `settings.section` list slot declared
 * by `dsh-client-ui-settings`; the section body fetches same-origin JSON
 * from the host plugin's web-server route and renders it with the shared
 * pure dashboard modules (no chart library, no extra runtime deps).
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: browser runtime services — declares ctx.slots (SlotRegistry).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings shell's SlotMap merge ('settings.section').
// Cross-plugin collaboration goes through slots, never a value import.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DashboardData } from './aggregate.ts'
import { renderDashboardBody } from './dashboard.ts'

export const name = 'tokens-dashboard-client'

/** Required services (the settings slot registry). */
export const inject = ['slots']

/** Chart windows offered in the toolbar, in days. */
const WINDOWS: readonly number[] = [7, 30, 90]
const REFRESH_MS = 10000
const DATA_URL = '/tokens-dashboard/data'

const TOOLBAR_STYLE = `
.td-settings .td-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.td-settings .td-toolbar button {
  background: #171a21; color: #aeb6c8; border: 1px solid #232833; border-radius: 8px;
  padding: 4px 12px; font-size: 12px; cursor: pointer;
}
.td-settings .td-toolbar button.td-active { color: #e6e9f0; border-color: #4d6bfe; }
.td-settings .td-hint { color: #8b93a7; font-size: 12px; margin-left: auto; }
.td-settings .td-error { color: #ef4444; font-size: 12px; margin-left: auto; }
`

export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'tokens-dashboard',
        order: 80,
        label: () => '模型用量',
      },
      UsageSection,
    ),
  )
}

function UsageSection(): ReactElement {
  const [days, setDays] = useState(30)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(0)
  const daysRef = useRef(days)
  daysRef.current = days

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`${DATA_URL}?days=${daysRef.current}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as DashboardData
        if (cancelled) return
        setHtml(renderDashboardBody(data))
        setUpdatedAt(data.generatedAt)
        setError('')
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void load()
    // Refresh while the tab is visible; the host re-renders data per request.
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [days])

  return (
    <div className="td-settings">
      <style>{TOOLBAR_STYLE}</style>
      <div className="td-toolbar">
        {WINDOWS.map(window => (
          <button
            key={window}
            className={window === days ? 'td-active' : ''}
            onClick={() => setDays(window)}
          >
            近 {window} 天
          </button>
        ))}
        {error !== '' ? (
          <span className="td-error">数据加载失败：{error}</span>
        ) : (
          <span className="td-hint">
            {updatedAt > 0
              ? `每 ${REFRESH_MS / 1000} 秒自动刷新 · 上次 ${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
              : '加载中…'}
          </span>
        )}
      </div>
      {html !== '' && <div dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}
