# dsh-tokens-dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Node.js](https://img.shields.io/badge/node-24.9%2B-339933.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org)
[![Platform: DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d6bfe.svg)](https://github.com/deepseek-ai/deepseek-harness)

[简体中文](../README.md) | English

A **model usage dashboard** plugin for DeepSeek Harness (DSH): it automatically records the token consumption of every model request and adds a dedicated「模型用量」(Model Usage) tab to the **DSH settings page**, showing summary cards, smooth per-model daily usage curves and donut share charts (with cost estimation).

## Features

- **Automatic collection**: listens to `session/event` and accumulates usage from every `assistant/message`'s `usage` (TokenUsage) attributed to its `provider/model`. Data is written to an append-only JSONL file (default `$DSH_HOME/plugin-data/tokens-dashboard/usage.jsonl`), aggregates can be rebuilt from it, and the writer is flushed and closed on unload/HMR.
- **Settings-page tab**: the client plugin registers a「模型用量」page into `settings.section` — a GitHub-style「Token 活动」activity heatmap at the top (one cell per day for the trailing year, with 每日/每周/累计 daily/weekly/cumulative view modes and hover tooltips), four summary cards (today / 7d / 30d / all), smooth daily per-model usage curves over the last N days (monotone cubic interpolation, with data points and a faint under-fill), tokens and cost donut charts, and a per-model detail table. The 7/30/90-day window switches with a smooth morph animation, and the page auto-refreshes every 10 seconds (only while visible), always showing up-to-date data that includes today.
- **Hover interactions**: hovering a donut slice enlarges it slightly and pops a tooltip in the same style as the curve chart's (model, share, value — USD on the cost chart); hovering the curve chart shows a crosshair plus a tooltip with every model's usage on the pointed day, with the day's total beside the date.
- **Data path**: the host plugin registers a same-origin route `/tokens-dashboard/data` on DSH's own web server (GET, `?days=` selects the window). The settings page simply fetches it — no port discovery, no cross-origin, no extra service.
- **`usage_report` model tool**: the model can query text reports (totals, per-model, per-day) for the `today / 7d / 30d / all` windows at any time.
- **Cost estimation**: declare per-model pricing (USD per 1M tokens, exact id or prefix match) in the config and the cards / donut charts / detail table carry costs; without pricing, costs stay 0.

## Architecture

The plugin consists of two halves (the official client-modules convention):

- **Host half** (`src/index.ts`, a cordis plugin): collection, storage, tool and web routes. `inject: ['sessions', 'tools']`; `webServer` is a soft dependency via `ctx.inject(['webServer'], …)` — on headless/sdk/acp profiles without a web server that sub-plugin stays dormant while collection and the tool keep working.
- **Browser half** (`src/client.tsx`, built artifact `lib/client.js`): declares `dsh.client` (`platform: "web"`) and is loaded by the client-modules system to register and render the `settings.section` page. The build artifact is a lazy CJS factory (`window.__ModuleLoader__.load({ id, factory })`) produced by `scripts/build-client.mjs` with esbuild (the official tsdown preset is unpublished, so it is replicated here).

## Requirements

- Node.js ≥ 24.9; the DSH runtime (`dsh` CLI); a web profile (the settings UI is only available in the web composition)
- Git ≥ 2.26

## Installation

```sh
# Install from a local checkout (linked installs skip prepare — build the client half first)
npm install                # triggers prepare → produces lib/client.js
dsh plugin --profile demo add /path/to/dsh-tokens-dashboard

# Verify the patch layer (should show "# == dsh-tokens-dashboard")
dsh --profile demo --dump-config

# Install from npm (after publishing; pnpm runs prepare to build lib/client.js)
dsh plugin --profile demo add dsh-tokens-dashboard
```

Host-shared packages such as `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` are provided by the dsh runtime through `peerDependencies`; react and the slots runtime used by the browser half are likewise provided by the page module table (all external at build time).

## Configuration (cordis.yml / patch override)

```yaml
- id: tokens-dashboard
  name: dsh-tokens-dashboard
  config:
    # dataDir: 'D:/dsh-data/tokens-dashboard'   # default: $DSH_HOME/plugin-data/tokens-dashboard (or ~/.dsh/...)
    chartDays: 30            # default curve window (days); switchable in the settings toolbar
    pricing:                 # USD / 1M tokens, keyed by exact model id or prefix
      deepseek-chat:
        input: 0.27
        output: 1.10
        cacheRead: 0.07
        cacheWrite: 1.10
      deepseek-reasoner:
        input: 0.55
        output: 2.19
        cacheRead: 0.14
        cacheWrite: 2.19
```

## Usage

Open the DSH settings panel → the「模型用量」tab in the navigation. Data is collected continuously without any command; the `?days=` window is switched through the toolbar buttons.

## Local development

```sh
npm install          # devDependencies (esbuild, client type packages) + prepare builds lib/client.js
npm run typecheck    # tsc --noEmit (host and client share one tsconfig)
npm test             # node:test (native TS on Node 24)
npm run build:client # rebuild the browser half on demand
```

Note: dsh's client-modules require the `./client` export to be a **built** artifact — activation fails explicitly when it is missing. After changing `src/client.tsx` or the shared pure-function modules, run `npm run build:client` again; HMR picks up the bundle change and hot-swaps the browser half.

## Data & privacy

All usage data stays in a local JSONL file; the web route is served only by DSH's own web server (loopback by default) and nothing is sent outward. The route carries no session auth — it is read-only aggregate statistics, reachable from the local machine only.

## Known limitations (future work)

- Only committed `assistant/message` events are collected; failed attempts (stream usage embedded in `assistant/attempt`) and backfilling historical sessions are not supported yet.
- The tool output is currently a text report; structured JSON output awaits a closer look at the `ValueSchemaSpec` details.
- The settings tab is only visible on web profiles; on headless, use the `usage_report` tool.
- Persistence uses the plugin's own JSONL for now; migrating to the official `ctx.storage` domain KV is an option.
- `--legacy-peer-deps`: the peer chain of the settings/slots type packages reaches into unpublished host internals, so a local `npm install` needs that flag (pinned in this README and package-lock).

## License

[MIT](../LICENSE) © ATMLuck
