# dsh-tokens-dashboard

DeepSeek Harness (DSH) 的 tokens 用量仪表盘插件（开发中）。

基于 Cordis 插件框架（一切皆插件），通过 `apply(ctx)` 注册能力，监听会话/流式事件渲染 token 用量视图。

## 环境要求

- Node.js ≥ 24.9（启用 TypeScript 类型剥离）
- Corepack 启用的 pnpm
- Git ≥ 2.26

## 快速开始（本地插件加载）

```sh
# 1. 写插件入口 src/index.ts，导出 name + apply(ctx)
# 2. 用 --patch overlay 挂到 Web UI（路径须为绝对路径）
pnpm dsh web --patch ./cordis.overlay.yml
```

发布时打包为 bundle（`package.json` 声明 `dsh.bundle` → `cordis.patch.yml`），用 `dsh plugin --profile <name> add <pkg>` 安装。

## 目录约定

- `src/` — 插件源码
- `dev-notes/` — 本地开发笔记与规范摘要（已 gitignore，不入库）

## 参考资料

- 官方仓库：https://github.com/deepseek-ai/deepseek-harness （`docs/` 为权威规范）
- 规范总结：见 `dev-notes/dsh-plugin-dev-spec.md`（本地）
