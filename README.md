<p align="center">
	<img src="packages/docat-web/public/docat-logo.png" alt="docat logo" width="240" />
</p>

<h1 align="center">Docat</h1>

docat 是一个用于设备编排与自动化的开源工具集，采用 Client–Server 架构，目标是为 Dobot 机器人及类似设备提供统一的驱动、传输与脚本执行能力。

核心目标：可扩展的设备驱动层、轻量的远程脚本执行、以及用于集成与自动化的 SDK/CLI 与 Web 界面。

## 主要功能概览

- 设备抽象层与驱动：统一 `DeviceDriver` 接口，支持多种传输（HTTP、SFTP、TCP 等）。
- 会话与共享资源管理：`SharedSession` 和设备池（`DevicePool`）用于并发与资源隔离。
- 事件总线：内部事件分发，便于扩展插件与异步任务。
- REST & WebSocket API：用于控制台与外部系统集成。
- 前端应用：用 Vite + Vue 构建的管理界面。

## 仓库（概要）

- `packages/docat-server` — 后端服务：设备驱动、调度、API、认证与持久化。
- `packages/docat-web` — 前端管理 UI（Vite + Vue）。
- `packages/docat-cli` — 命令行工具，用于脚本化操作与自动化任务。
- `packages/docat-sdk` — 客户端 SDK，用于集成到第三方服务或脚本。
- `packages/docat-shared` — 共享类型、错误类型与协议定义。

## 开发与运行（本地快速指南）

先决条件：

- Node.js：>= 20.0.0（建议使用最新 20.x LTS），检查：`node -v`。
- pnpm：>= 11.1.2（根目录 `package.json` 声明 `packageManager: "pnpm@11.1.2"`），检查：`pnpm -v`。
- Turbo（用于 monorepo 任务运行）：项目依赖 `turbo`，推荐使用与 `package.json` 中匹配的版本，检查：`pnpx turbo -v` 或 `pnpm dlx turbo -v`。

安装/启用 pnpm（示例）：

```bash
# 使用 corepack（Node 16+ 自带）启用并激活 pnpm
corepack enable
corepack prepare pnpm@11.1.2 --activate
# 或使用 npm 全局安装（替代）
npm i -g pnpm@11
```

1) 在仓库根目录安装依赖：

```bash
pnpm install
```

2) 启动开发模式（monorepo 使用 `turbo` 管理包内任务）：

```bash
pnpm dev
```

这会并行/串行启动各包的开发任务（如 server、web）。若只想启动某个包，使用 workspace 过滤器：

```bash
pnpm --filter ./packages/docat-server dev
pnpm --filter ./packages/docat-web dev
```

3) 构建（生产）

```bash
pnpm build
```

4) 测试 / Lint / 类型检查

```bash
pnpm test
pnpm lint
pnpm typecheck
```

## 运行细节

- 后端默认：`packages/docat-server` 启动 REST 与 WebSocket 服务，默认配置可通过环境变量或 `packages/docat-server/config` 加载。
- 前端默认：`packages/docat-web` 在 `localhost:5173`（Vite 默认端口）提供管理界面。
- CLI：`packages/docat-cli` 提供与后端交互的便捷命令，适合脚本化流程与 CI。

示例：在本地启动后端并访问前端

```bash
pnpm --filter ./packages/docat-server dev
pnpm --filter ./packages/docat-web dev
# 在浏览器打开 http://localhost:5173
```

## 代码与扩展点说明

- 设备驱动：查看 `packages/docat-server/src/device/DeviceDriver.ts` 与 `packages/docat-server/src/device/drivers`，新驱动可实现 `DeviceDriver` 接口并注册到 `DeviceFactory`。
- 传输层：实现或复用 `transport/*`（如 `HttpTransport.ts`、`SftpTransport.ts`、`TcpTransport.ts`）以封装底层连接细节。
- 脚本系统：脚本相关代码位于 `packages/docat-server/src/script`，可扩展脚本语言与运行沙箱。
- 访问调度：`AccessScheduler` 用于实现对设备访问的排队与租用逻辑。

## 配置与环境变量

- 在开发环境中可使用根目录或包级别的 `.env` 文件（未加入仓库），常见变量示例：

```
PORT=3000
DB_URL=file:./data/sqlite.db
API_KEY=secret
```

具体变量请查看 `packages/docat-server` 中的配置加载逻辑。

## 调试与日志

- 后端日志通常写入控制台；生产部署建议配置日志收集与持久化目录（`packages/docat-server/data/`）。
- 前端使用浏览器开发工具与 Vite 的热重载。

## 常见维护操作

- 删除多余锁文件：若你使用 `pnpm`，请移除 `package-lock.json` 与 `yarn.lock`（仅保留 `pnpm-lock.yaml`）。
- 清理构建产物：`pnpm run clean` 或手动删除 `dist/`、`.turbo/`、`.cache/` 等目录。

## 开发者指南（快速要点）

- 保持单一包管理器（本仓库推荐 `pnpm`）。
- 在提交前运行 `pnpm lint` 与 `pnpm test`。
- 新增驱动或 transport 时，添加单元测试并更新文档。


