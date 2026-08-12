# Docat 开发规范

## 构建与验证

- 依赖管理：pnpm workspace（`packages/*`），使用 `pnpm install` 安装。
- 构建/测试统一走 turbo：`pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm clean`。
- 修改代码后必须通过对应包的 typecheck：
  - `pnpm --filter docat-server typecheck`
  - `pnpm --filter docat-web typecheck`
- 新加依赖后运行 `pnpm install` 更新 `pnpm-lock.yaml` 并一并提交。

## 类型声明（.d.ts）

- `.gitignore` 中的 `*.d.ts` 仅用于忽略**构建产物**（`tsc` 生成，`declaration: true`）。
- 手写的类型声明 shim（如 `src/types/*.d.ts`、`src/shims-*.d.ts`）**必须提交入库**：
  - 在 `.gitignore` 中 `*.d.ts` 规则之后添加 `!` 例外行；
  - 禁止用 `.ts` 文件 + `declare module` 绕行——模块声明合并会以 `any` 覆盖精确类型，且 `declare module` 仅存在于全局脚本中。
- 能装官方 `@types/*` 包就不用自写 shim；若必须自写，保持与 `.d.ts` 精确类型一致。

## 跨平台（Windows 兼容）

- 行尾统一 LF（`.gitattributes` 已强制 `eol=lf`）。不要在 Windows 上把文件保存为 CRLF 后直接提交，这会污染 diff。
- 包脚本若在 Windows 上出现信号/子进程问题（如 `tsx watch` 收不到 Ctrl+C），用 `scripts/` 下的 Node 包装脚本（`dev-server.cjs` 是范例），不要用 bash-only 语法。
- 平台相关依赖（如 better-sqlite3）默认走 prebuilt 二进制，避免依赖本地构建工具链。

## 提交

- 不要用 `git add -A` 混提无关改动；功能（如新驱动）与适配/修复分开提交。
- 只提交有意改动，检查 `git status` 与 `git diff --stat` 确认无行尾/格式噪声。
