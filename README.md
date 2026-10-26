# dsh-tokens-dashboard

DeepSeek Harness (DSH) 的**模型用量仪表盘**插件：自动记录各模型每次请求的 token 消耗，按日/按模型汇总，生成带汇总卡片、堆叠曲线图和占比饼图的 HTML 仪表盘，并提供模型工具与斜杠命令两种查询入口。

## 功能

- **自动采集**：监听 `session/event`，从每条 `assistant/message` 的 `usage`（TokenUsage）与 `provider/model` 归属累计用量；数据以追加式 JSONL 落盘，可重建聚合，卸载/HMR 时自动冲刷关闭。
- **DSH 内置预览（推荐）**：插件在 `127.0.0.1` 起一个回环 HTTP 服务，每次请求都实时渲染最新数据；`/usage` 返回该地址的链接，点击即在 **DSH 右侧栏 browser 窗格**（应用内 iframe 预览）中打开——DSH 的浏览器窗格接受 loopback HTTP(S) 目标。若聊天"链接偏好"设置指向系统浏览器，可在 Web Client 设置中改回，或继续使用右侧栏 Guide/browser 手动输入该地址。
- **实时仪表盘**：每条新用量落盘后自动（防抖）重建 `usage-dashboard.html` 文件快照；页面内置前台可见性感知的 10 秒自动刷新。
- **`usage_report` 模型工具**：模型可随时调用查询 `today / 7d / 30d / all` 窗口的文本报告（总计、按模型、按日）。
- **`/usage` 人类命令**：生成独立 HTML 仪表盘（默认自动打开），并在会话中返回文本摘要；支持 `/usage 14` 之类自定义天数窗口。
- **HTML 仪表盘**：今日/近7天/近30天/累计四张汇总卡片、近 N 天按模型堆叠的每日 token 曲线图（每个数据日带标记点，今日加重显示）、tokens 与费用两张占比环形图、按模型明细表；单文件、内联 SVG、零外部依赖（内联脚本仅做自动刷新）。
- **费用估算**：在配置中声明各模型 USD/1M token 定价（支持前缀匹配），仪表盘与报告即带费用；未配置时费用为 0。

## 环境要求

- Node.js ≥ 24.9；启用的 pnpm（dsh 运行时）；Git ≥ 2.26
- 一个可运行的 `dsh`（npm 安装或源码 checkout）

## 安装（组合包方式）

本包声明了 `dsh.bundle` manifest（`cordis.patch.yml`），可直接安装进 profile：

```sh
# 从本仓库 checkout 链接安装（保留本地 node_modules）
dsh plugin --profile demo add /path/to/dsh-tokens-dashboard

# 验证 patch 层已生效（应能看到 "# == dsh-tokens-dashboard"）
dsh --profile demo --dump-config

# 从 npm 安装（发布后）
dsh plugin --profile demo add dsh-tokens-dashboard
```

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools` 等宿主共享包声明在 `peerDependencies`，由 dsh 运行时提供；插件本体可直接以 TypeScript 加载（dsh 经 tsx 运行），无需构建步骤。

## 配置（cordis.yml / patch 覆盖）

```yaml
- id: tokens-dashboard
  name: dsh-tokens-dashboard
  config:
    # dataDir: 'D:/dsh-data/tokens-dashboard'   # 默认 $DSH_HOME/plugin-data/tokens-dashboard（或 ~/.dsh/...）
    chartDays: 30            # 曲线图窗口（天）
    dashboardServer: true    # 在 127.0.0.1 提供实时预览（供 DSH 右侧栏 browser 窗格内嵌）
    dashboardPort: 0         # 0 = 自动选择空闲端口；固定端口便于收藏
    openAfterRender: false   # true = /usage 后额外调用系统浏览器（默认关闭）
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

硬依赖服务为 `sessions` 与 `tools`（core 提供）；`commands` 为可选依赖，缺失时仅 `/usage` 不可用，采集与工具照常工作。

## 使用

| 入口 | 说明 |
|---|---|
| 对话输入 `/usage` | 生成并打开 HTML 仪表盘，返回文本摘要 |
| 模型调用 `usage_report` | `period` 可选 today / 7d / 30d / all |
| 直接打开 HTML | `<dataDir>/usage-dashboard.html` |

## 本地开发

```sh
npm install          # 安装 devDependencies（cordis 类型、dsh-tools、schemastery）
npm run typecheck    # tsc --noEmit
npm test             # node:test（Node 24 原生 TS 运行）
```

在源码 harness checkout 中联调：把本包 checkout 链接进任一 profile（`dsh plugin --profile dev add <path>`），或用 `--patch` overlay 以绝对路径直插 `src/index.ts`（见 `dev-notes/dsh-plugin-dev-spec.md` §8）。

## 数据与隐私

所有用量数据只写入本地 `<dataDir>/usage.jsonl` 与生成的 HTML，不外发。删除 JSONL 即清空历史；文件按行追加，损坏行会被跳过并记录错误。

## 已知边界（后续工作）

- 仅采集已提交的 `assistant/message`；失败尝试（`assistant/attempt` 内嵌 stream usage）与历史会话回填暂不支持。
- 工具输出当前为文本报告；结构化 JSON 输出待 `ValueSchemaSpec` 细节核对后再加。
- Web Client 内嵌 Chat 节点（`ConversationNodeDefinition` + keyed renderer）未实现；当前仪表盘为独立 HTML 页面。
- 持久化暂用插件自有 JSONL；如需迁移可改走官方 `ctx.storage` 领域 KV。

## 目录约定

- `src/` — 插件源码（纯函数模块与 cordis 接线分离）
- `tests/` — node:test 单元测试
- `dev-notes/` — 本地开发笔记与官方规范摘要（已 gitignore，不入库）

## 参考资料

- 官方仓库：<https://github.com/deepseek-ai/deepseek-harness>（`docs/` 为权威规范）
- 规范总结：`dev-notes/dsh-plugin-dev-spec.md`（本地）
- 设计笔记：`dev-notes/design.md`（本地）
