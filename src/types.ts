/**
 * Core usage data shapes shared by the recorder, aggregates and dashboards.
 *
 * These types intentionally mirror only the fields this plugin consumes from
 * the harness vocabulary (TokenUsage / ModelMessageSource) so that every pure
 * module stays importable without `@deepseek-ai/dsh-llm` at runtime.
 */

/** Per-call token accounting, mirroring the harness `TokenUsage` subset. */
export interface TokenUsageLike {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * One normalized per-request usage row. Counts mirror the disjoint harness
 * semantics: `inputTokens` is uncached input only and billed input is
 * `inputTokens + cacheReadTokens + cacheWriteTokens`; `reasoningTokens` are
 * informational and already included in `outputTokens`.
 */
export interface UsageRecord {
  /** Epoch milliseconds of the committed assistant message. */
  ts: number
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** USD price per 1M tokens for one model route. */
export interface ModelPricing {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** Pricing table keyed by exact model id or model id prefix. */
export type PricingMap = Record<string, ModelPricing>

/**
 * One heatmap cell: a local day (or an aggregated week) with its usage
 * totals, keyed by `YYYY-MM-DD` (week cells use their Monday).
 */
export interface HeatmapCell {
  date: string
  tokens: number
  requests: number
}

/**
 * Pricing is deployment-specific and changes over time, so it starts empty:
 * cost metrics stay 0 until the deployment configures `pricing` in
 * cordis.yml (keys are exact model ids or model id prefixes).
 */
export const DEFAULT_PRICING: PricingMap = {}
