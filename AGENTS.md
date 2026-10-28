# AGENTS.md — dsh-tokens-dashboard 开发指南

本文件面向在本仓库工作的 AI agent（及新会话的你自己）。目标是：任何新会话读完此文件后，
能延续既有架构、代码风格、验证流程和提交规范继续开发 DSH 插件，而不需要重新踩坑。

## 1. 项目是什么

`dsh-tokens-dashboard` 是一个 DeepSeek Harness（DSH / Cordis）插件：采集各模型的 token
用量，在 DSH 设置页内提供「模型用量」标签页（汇总卡片 + Token 活动热力图 + 平滑曲线图 +
tokens/费用环形图 + 明细表），另提供 `usage_report` 模型工具。零外部图表依赖，全部 SVG
手绘。

**双端架构**（改代码前必须分清自己在改哪一端）：

| 端 | 文件 | 加载方式 | 修改后需要 |
| --- | --- | --- | --- |
| 宿主半（Node） | `src/index.ts`、`recorder.ts`、`usage-store.ts`、`web-routes.ts`、`tool.ts`、`config.ts`、`types.ts` | DSH 直接用 tsx 加载 TS | 重启 `dsh web` |
| 共享纯逻辑 | `src/aggregate.ts`、`charts.ts`、`days.ts`、`dashboard.ts`、`morph.ts`、`types.ts` | 两端共用 | 重建浏览器 bundle |
| 浏览器半（Web） | `src/client.tsx`、`preview.tsx` | 预构建产物 `lib/client.js`（lazy-CJS 工厂） | `npm run build:client` + 重启 `dsh web`（或 HMR） |

任何 `client.tsx` / 其依赖链的改动，**提交前必须 `npm run build:client` 重建
`lib/client.js`**——DSH 不会帮你编译浏览器半。`lib/` 与 `preview/` 均已 gitignore，
不入库。

## 2. 必读资料（本地、不入库）

- `dev-notes/dsh-plugin-dev-spec.md` — 官方 DSH 插件编写规范的总结（366 行），插件模型、
  slots、bundle 补丁、发布规范都在里面。不确定宿主 API 时先查它，不要猜。
- `dev-notes/design.md` — 数据源与存储设计决策（阶段0 确认记录）。

## 3. 开发注意事项（环境与 DSH 特有）

### 3.1 环境

- Windows + Git Bash。**端口 8642 会 EACCES，预览服务器一律用 8770**。
- Node 24+（原生 TS type stripping 跑 `node --test` 和 `node scripts/*.ts`）。
- 常用命令：
  - `npm test` — 单测（4 个测试文件；**新增测试文件必须同步加进 package.json 的 test 脚本**）
  - `npx tsc --noEmit` — 类型检查（提交前必须过）
  - `npm run build:client` — 重建 `lib/client.js`
  - `node scripts/build-preview.mjs` — 重建独立预览 bundle（gitignored）
  - `node scripts/preview-server.ts 8770` — 启动预览服务器（后台运行）

### 3.2 DSH/Cordis 插件模型

- 入口契约：`export const name`、`export const inject`（硬依赖服务名数组）、
  `export const Config`（schemastery schema）、`export function apply(ctx, config)`。
- **副作用必须可逆**：用 `ctx.effect(() => { …; return () => { 清理 } })` 包裹（如
  UsageStore 的 load/close，保证 HMR 卸载时不留悬挂写句柄）。
- 可选服务用 `ctx.inject(['webServer'], …)`（webServer 缺失时该子分支休眠但其余功能正常）
  或 `ctx.get('commands')` 软探测。硬依赖才放进 `inject`。
- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`（把插件行插入 profile）；
  `dsh.client.platform: "web"` 声明浏览器半。`peerDependencies` + `devDependencies`
  并存是官方发布规范，不要合并。

### 3.3 浏览器半接入约定

- 只通过 **slots** 协作：`ctx.slots.inject('settings.section', …)` 注册设置页标签页，
  id 用 `tokens-dashboard`，`order: 80`。
- 对宿主包（`@deepseek-ai/dsh-client-runtime/client`、`@deepseek-ai/dsh-client-ui-settings/client`
  等）**只允许 `import type`**（`import type {}` 空导入声明 slots 类型）；值导入会让
  bundle 依赖宿主内部实现。
- 若 client 需要新的平台共享包（react 之外的宿主提供模块），要把它加进
  `scripts/build-client.mjs` 的 `PLATFORM_EXTERNALS`，否则会被打进 bundle 产生双实例。
- 数据经宿主 web 服务器的 same-origin 路由 `/tokens-dashboard/data?days=N` 获取
  （`web-routes.ts`），client 每 10s 拉一次，`document.hidden` 时跳过。

### 3.4 数据语义（改聚合逻辑前必读）

- 数据源：`session/event` 里 `type === 'assistant/message'` 的事件，读 `event.time`
  **按本机时区**做日分桶（`days.ts` 的 `dayKeyOf`）；归属来自
  `message.source.{provider, model}`。
- `TokenUsage`：计费输入 = `inputTokens + cacheReadTokens + cacheWriteTokens`（三者互不
  重叠）；**`reasoningTokens` 已包含在 `outputTokens` 内，任何汇总不得重复相加**。
- `usage` 缺失的记录跳过，不虚构；`interrupted` 的消息照常记录。
- 存储是 append-only JSONL（`usage.jsonl`，一行一条 `{v:1, ts, provider, model, …}`），
  坏行容忍、可重建聚合。官方 `ctx.storage` 方案列为后续迁移项，v1 不用。

## 4. 代码规范

### 4.1 TypeScript（tsconfig 强制，不要绕过）

- `strict` + `noUncheckedIndexedAccess`：所有下标访问结果视为 `T | undefined`，用
  `?? 默认值` 或显式 undefined 守卫（`const s = arr[i]; if (s === undefined) continue`）。
- `verbatimModuleSyntax`：类型导入一律 `import type { … }`。
- `erasableSyntaxOnly`：**禁用 enum、namespace、构造函数参数属性**，用
  `as const` 数组/联合类型/接口替代。
- `allowImportingTsExtensions`：相对导入**带 `.ts` 扩展名**（`from './charts.ts'`）。
- target es2024 / module nodenext；tsconfig `include: ["src", "tests", "scripts"]`。

### 4.2 分层与纯度

- **纯逻辑模块（charts/aggregate/days/dashboard/morph 的纯函数部分）禁止 DOM、禁止
  文件 IO、禁止第三方依赖**——它们要在 Node 单测里直接跑。DOM 操作只出现在
  `client.tsx` / `morph.ts` 的编排函数里。
- 渲染器是纯字符串函数（`renderDashboardHead/Charts`、`renderSmoothLineSVG`、
  `renderDonutSVG`、`renderHeatmapSVG`），同输入同输出，方便测试与快照断言。
- 注释用英文，只写"代码本身表达不了的约束/为什么"（例如"reasoningTokens 已含在
  outputTokens 内"、"native `<title>` 跟随系统主题色，故用自绘 tooltip"），不写流水账。

### 4.3 图表与 dashboard 约定

- 所有 CSS 规则 scoped 在 `.td-dashboard` / `.td-settings` 下（`DASHBOARD_STYLE` /
  `TOOLBAR_STYLE`），绝不污染宿主页面样式；类名统一 `td-` 前缀。
- **禁用 SVG `<title>` 原生 tooltip**（跟随系统明暗主题、弹出迟滞、与页面风格冲突）。
  所有 tooltip 由 client 读取 `data-*` 属性（`data-label/data-value/data-pct`、
  `data-date/data-tokens/data-requests`）用统一的 `.td-daytip` 样式渲染。
- 渲染器输出的**类名/结构是 client 的契约**，改动前先搜 client/morph 的选择器：
  `.td-linesvg`、`g.td-line-series[data-series]`、`svg.td-donut[data-unit]`、
  `.td-donut-total[data-total]`、`g.td-slice`、`.td-hcell`。
- 数字格式化统一走 `formatTokens`（K/M/B）、`formatWan`（中文 万/亿，热力图用）、
  `formatUsd`（<$1 保留 4 位小数）、`formatInt`；不要在调用点手写 toFixed。
- 表格列保持紧凑（已合并"缓存读+写"为一列），`.td-tablepanel { overflow-x: auto }`
  防止撑破设置页。

### 4.4 React client（client.tsx）模式

- 图表 fragment 用 `dangerouslySetInnerHTML` 挂载；**用签名 ref
  （`headSigRef`/`chartsSigRef`，JSON.stringify 关键数据）判断数据是否真的变了**，
  未变化跳过 innerHTML 替换，保住悬浮态。
- 需要"提交后、绘制前"改 DOM（如 morph 起始帧）必须用 `useLayoutEffect`，
  `useEffect` 会闪一帧最终态。
- morph 动画约定（`src/morph.ts`）：换 fragment 前从活 DOM 快照旧形状
  （`snapshotChartsFragment`），`startChartsMorph` 里 rAF 补间；必须有
  `prefers-reduced-motion` 跳过、anyChanged 守卫、以及 rAF 被挂起时的安全定时器兜底
  （保证 DOM 落到渲染器精确输出）。中断时 cleanup 恢复最终态，绝不留半成品 DOM。

## 5. 测试规范

- 框架：`node:test` + `node:assert/strict`，无 jsdom——**只测纯函数**（聚合、几何、
  字符串渲染器），不测 DOM。测试名用完整英文句子描述行为。
- 渲染器测试用字符串断言（`includes` / 正则计数），并同时断言"不该出现的东西"
  （如 `!includes('<title')`、`!includes('<script')`、HTML 转义）。
- 每次提交前：`npm test` 全绿 + `npx tsc --noEmit` 干净。两者任何一个不过不许提交。

## 6. 浏览器验证流程（UI 改动必做）

1. `node scripts/build-preview.mjs && node scripts/preview-server.ts 8770`（后台）。
   预览页挂载**真实的** `UsageSection`，`/tokens-dashboard/data` 由
   `scripts/preview-server.ts` 用一份 30 天稀疏数据（含 3 天前的 8.9M 尖峰日）模拟，
   与宿主路由同形。
2. 用 ZCode 的 browser-use 技能（IAB 后端）打开 `http://127.0.0.1:8770/`。
   **每个 `mcp__node_repl__js` 调用都是全新内核**：必须先跑 bootstrap
   （`setupBrowserRuntime`，root 取 `process.env.ZCODE_PLUGIN_ROOT`），再
   `agent.browsers.getForUrl(...)`；新一批操作前先 `browser.tabs.list()` 全量看一遍，
   再 `tabs.get(id)` 绑定，禁止凭记忆用 tab id / 按下标取。
3. **优先用 DOM 状态断言验证**（`tab.playwright.domSnapshot()`、`evaluate` 读属性），
   不要依赖截图：IAB 整页截图有拼接伪影；单视口 `clip` 截图可用。
4. 已知坑：
   - Playwright 角色 locator 的 click 可能超时（actionability 判定问题）——改用页面内
     `evaluate` 里的 `btn.click()`（事件冒泡到 React 根监听器，同样生效）。
   - IAB 窗口被遮挡时 rAF 会被节流/挂起（每帧间隔可达秒级）——验证动画用
     MutationObserver 记录 `d` 属性变化帧数与时间跨度，而不是掐秒截图；morph 的安全
     定时器会保证最终态正确。
   - 验证动画/悬浮这类时序敏感交互：先 `evaluate` 装 `window.__morphLog` /
     MutationObserver，再触发动作，再回读。
5. 验证完：关闭预览 tab（`tab.close()`）、停掉预览服务器（TaskStop）。

## 7. 仓库提交规范

- **Conventional Commits，英文祈使句小写开头**，格式 `type: subject`。
  实际使用过的 type：`feat` / `fix` / `refactor` / `docs` / `test` / `chore`。
  主题行示例（取自历史，保持这种粒度与语气）：
  - `feat: smooth morph animations when switching chart windows`
  - `fix: compact model table to fit the settings tab width`
  - `refactor: move the window switcher above the daily curve chart`
- 一个提交一个逻辑变更（一个功能点或一个修复）；正文（body）可选用要点列出关键实现
  与动机，英文。
- **每个完成的阶段/修复都立即提交**（用户固定的流程要求），不要攒大提交；提交前确认
  `npm test` + `tsc` 通过、`lib/`、`preview/`、`dev-notes/` 不入库。
- 会话结束时工作区保持 clean。新会话开始时先 `git log --oneline` 了解进度。

## 8. 工作流程要求（用户固定的协作约定）

1. **每个阶段先建 todo list**（TodoWrite），按清单开发，完成后逐项标记 completed。
2. UI 相关改动必须在真实浏览器里验证（见第 6 节流程），并给出验证证据（DOM 断言或
   单视口截图）。
3. 每个完成的阶段/修复做一次 git 提交（见第 7 节）。
4. 用户用中文交流；回复先给结论（TLDR），再给细节。向用户报告时如实说明失败/跳过的部分。

## 9. 当前状态与后续方向

已实现（截至 e61f7e9）：用量采集（recorder + JSONL）、`usage_report` 工具、same-origin
数据路由、设置页「模型用量」标签页（卡片/热力图/平滑曲线/双环形图/明细表）、窗口切换
morph 动画、悬浮 tooltip（曲线按天 + 饼图按扇形 + 热力图按格）、每日 token 总量显示在
曲线 tooltip 日期旁。37 个单测全绿。

已知可做的后续方向（用户未要求，勿擅自开工）：
- 曲线 tooltip 中加当天费用列；每条曲线悬停交点高亮圆点。
- 曲线图支持 每周 聚合维度与 tokens/费用 指标切换。
- JSONL 迁移到官方 `ctx.storage` domain；采集 `assistant/attempt` 的失败尝试 usage。
- 数据量大时的读取性能（当前每次全量加载 JSONL 后聚合）。

改 UI 前先跑 `git log --oneline -10` 与本文件第 4 节，避免重复踩已修的坑
（原生 title tooltip、表格撑破边框、堆叠柱状图等都是用户明确否决过的形态）。
