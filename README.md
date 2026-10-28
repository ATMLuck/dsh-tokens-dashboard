# dsh-tokens-dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-24.9%2B-339933.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org)
[![Platform: DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d6bfe.svg)](https://github.com/deepseek-ai/deepseek-harness)

[English](docs/README.en.md) | 简体中文

DeepSeek Harness (DSH) 的**模型用量仪表盘**插件：自动记录各模型每次请求的 token 消耗，并在 **DSH 设置页中新增一个「模型用量」标签页**，展示汇总卡片、各模型的平滑每日用量曲线图和占比环形图（含费用估算）。

## 功能

- **自动采集**：监听 `session/event`，从每条 `assistant/message` 的 `usage`（TokenUsage）与 `provider/model` 归属累计用量；数据以追加式 JSONL 落盘（默认 `$DSH_HOME/plugin-data/tokens-dashboard/usage.jsonl`），可重建聚合，卸载/HMR 时自动冲刷关闭。
- **设置页标签**：客户端插件向 `settings.section` 注册「模型用量」页面——顶部「Token 活动」热力图（GitHub 风格日历格子，近一年每日一格，支持 每日/每周/累计 三种视图与悬停提示）、四张汇总卡片（今日/近7天/近30天/累计）、近 N 天各模型的平滑日用量曲线（单调三次插值，带数据点与淡填充）、tokens 与费用两张占比环形图、按模型明细表；支持 7/30/90 天窗口切换，页面每 10 秒自动刷新（仅前台可见时），显示的始终是含今日在内的最新数据。
- **悬浮交互**：环形图切片悬浮时略微放大，并弹出与曲线图同款的提示框（模型、占比、数值，费用图显示美元）；曲线图悬浮时显示十字线与所指当日的各模型用量明细提示框。
- **数据通路**：主机插件在 DSH 自身的 web server 上注册同源路由 `/tokens-dashboard/data`（GET，`?days=` 可调窗口），设置页直接 fetch，无端口发现、无跨域、无额外服务。
- **`usage_report` 模型工具**：模型可随时调用查询 `today / 7d / 30d / all` 窗口的文本报告（总计、按模型、按日）。
- **费用估算**：在配置中声明各模型 USD/1M token 定价（支持前缀匹配），卡片/环形图/明细表即带费用；未配置时费用为 0。

## 组成结构

插件由两个半侧组成（官方 client-modules 约定）：

- **主机半侧**（`src/index.ts`，cordis 插件）：采集、存储、工具、web 路由。`inject: ['sessions', 'tools']`；`webServer` 通过 `ctx.inject(['webServer'], …)` 软依赖——headless/sdk/acp 等 profile 没有 web server 时该子插件保持休眠，采集与工具照常工作。
- **浏览器半侧**（`src/client.tsx`，构建产物 `lib/client.js`）：声明 `dsh.client`（`platform: "web"`），由 client-modules 系统加载，注册 `settings.section` 页面并渲染。构建产物是惰性 CJS factory 格式（`window.__ModuleLoader__.load({ id, factory })`），由 `scripts/build-client.mjs` 用 esbuild 生成（官方 tsdown 预设未发布，仓库外需自行复刻）。

## 环境要求

- Node.js ≥ 24.9；DSH 运行时（`dsh` CLI）；Web profile（设置页 UI 仅在 web 组合可用）
- Git ≥ 2.26

## 安装

```sh
# 从本仓库 checkout 链接安装（链接安装不执行 prepare，请先本地构建客户端半侧）
npm install                # 触发 prepare → 产出 lib/client.js
dsh plugin --profile demo add /path/to/dsh-tokens-dashboard

# 验证 patch 层（应出现 "# == dsh-tokens-dashboard"）
dsh --profile demo --dump-config

# 从 npm 安装（发布后，pnpm 会执行 prepare 自建 lib/client.js）
dsh plugin --profile demo add dsh-tokens-dashboard
```

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools` 等宿主共享包在 `peerDependencies` 中由 dsh 运行时提供；浏览器半侧依赖的 react、slots 运行时等同理由页面模块表提供（构建时全部 external）。

## 配置（cordis.yml / patch 覆盖）

```yaml
- id: tokens-dashboard
  name: dsh-tokens-dashboard
  config:
    # dataDir: 'D:/dsh-data/tokens-dashboard'   # 默认 $DSH_HOME/plugin-data/tokens-dashboard（或 ~/.dsh/...）
    chartDays: 30            # 默认曲线图窗口（天）；设置页工具栏可临时切换
    pricing:                 # USD / 1M tokens，键为精确模型名或前缀
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

## 使用

打开 DSH 设置面板 → 导航中的「模型用量」标签。数据自动持续采集，无需任何指令；`?days=` 参数对应的窗口由工具栏按钮切换。

## 本地开发

```sh
npm install          # devDependencies（esbuild、客户端类型包）+ prepare 构建 lib/client.js
npm run typecheck    # tsc --noEmit（主机 + 客户端同一 tsconfig）
npm test             # node:test（Node 24 原生 TS 运行）
npm run build:client # 单独重建浏览器半侧
```

注意：dsh 的 client-modules 要求 `./client` 导出是**已构建**产物——缺失时插件激活会明确失败。改完 `src/client.tsx` 或共享纯函数模块后需重新 `npm run build:client`；HMR 检测到 bundle 变化会自动热替换浏览器半侧。

## 数据与隐私

所有用量数据只写入本地 JSONL；web 路由仅由 DSH 自身的 web server（默认 loopback）服务，不做外发。路由未挂会话认证——只读的聚合统计，仅本机可达。

## 已知边界（后续工作）

- 仅采集已提交的 `assistant/message`；失败尝试（`assistant/attempt` 内嵌 stream usage）与历史会话回填暂不支持。
- 工具输出当前为文本报告；结构化 JSON 输出待 `ValueSchemaSpec` 细节核对后再加。
- 设置页仅 web profile 可见；headless 下可用 `usage_report` 工具查询。
- 持久化暂用插件自有 JSONL；如需迁移可改走官方 `ctx.storage` 领域 KV。
- `--legacy-peer-deps`：settings/slots 类型包的 peer 链伸入未发布的 host 内部包，本地 `npm install` 需带该 flag（README 与 package-lock 已按此固定）。

## 许可证

[MIT](LICENSE) © ATMLuck
