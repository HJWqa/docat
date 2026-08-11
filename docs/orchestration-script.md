# 编排脚本 API 文档

编排（Orchestration）脚本运行在 **docat-server 端**：JS 由 Node 子进程（vm 沙箱）执行，Python 由 python3 子进程执行（服务端需安装 python3）。脚本**不负责**设备连接/重连/心跳——这些由编排引擎处理，脚本只写逻辑。

## 运行方式

- 真实模式：脚本文件放在服务端脚本目录（「通用」设置可改，默认 `./data/orch-scripts`），脚本页选择文件 → 运行。支持 JS（`.js/.mjs/.cjs`）与 Python（`.py`）。
- 运行/重新运行/终止由脚本页控制；终止 = 服务端杀掉脚本进程。
- 顶层代码执行完毕后：若注册了消息监听器则脚本保持运行（事件驱动）；否则脚本自然结束。

## 事件模型（顺序处理）

设备消息/连接事件按到达顺序**逐个处理**（与 `pick_place_tcp.py` 风格一致）。JS 处理器可 `async`；Python 处理器为同步函数（可用 `docat.utils.sleep` 阻塞等待，不影响消息接收）。

## API（JS 与 Python 语义一致）

### devices — 设备收发

| JS | Python | 说明 |
|---|---|---|
| `devices.send(设备名, 文本)` | `docat.devices.send(设备名, 文本)` | 按设备名发送消息；设备未连接会记错误日志 |
| `devices.onMessage(设备名, cb)` | `@docat.devices.on_message(设备名)` | 设备收到消息时回调，参数为文本 |
| `devices.onConnect(设备名, cb)` | `@docat.devices.on_connect(设备名)` | 设备连接事件（运行中才注册的处理器不会收到已发生的连接） |
| `devices.onDisconnect(设备名, cb)` | `@docat.devices.on_disconnect(设备名)` | 设备断开事件 |
| `devices.isConnected(设备名)` | `docat.devices.is_connected(设备名)` | 查询连接状态（本地快照，同步） |
| `devices.waitFor(设备名, 匹配, 超时ms?)` | `docat.devices.wait_for(设备名, 匹配, 超时ms?)` | **等待设备下一条匹配消息**（Promise，超时 reject） |
| `devices.sendAndWait(设备名, 文本, 匹配)` | `docat.devices.send_and_wait(设备名, 文本, 匹配)` | 发送并等待匹配应答 |

**匹配规则**：字符串按**前缀匹配**（如 `'GP;reached;'`），或传函数 `(msg) => boolean`。默认超时 10s，超时抛错（可 try/catch）。

Docat Motion 的 GP 回调示例：

```js
devices.send('am', 'GP;100;0;60;0;0;0;300;50;60;0;0;0')
await devices.waitFor('am', 'GP;received;')   // 已接收
await devices.waitFor('am', 'GP;reached;')    // 执行完成
log.info('取放完成')
```

Python 同语义：`docat.devices.wait_for('am', 'GP;reached;')`。

### poses — 姿态

姿态在「设置 → 姿态」中存储，命名须符合变量命名规则（`/^[A-Za-z_][A-Za-z0-9_]*$/`），独立于设备页姿态。

| JS | Python | 说明 |
|---|---|---|
| `poses.get(姿态名)` | `docat.poses.get(姿态名)` | **返回数组**：位姿 → `[x,y,z,rx,ry,rz]`；关节角 → `[j1..j6]` |
| `poses.get(姿态名, ';')` | `docat.poses.get(姿态名, sep=';')` | **传入分隔符返回文本**，如 `"100;0;50;0;0;0"` |
| `poses.list()` | `docat.poses.list()` | 姿态名列表 |

不存在的姿态返回 `undefined` / `None`。

### utils — 工具

| JS | Python | 说明 |
|---|---|---|
| `utils.toArray(文本, sep=';')` | `docat.utils.to_array(文本, sep=';')` | 按分隔符解析字符串为数组（去空白/空字段，默认 `;`） |
| `utils.toString(数组, sep=';')` | `docat.utils.to_string(数组, sep=';')` | 数组拼接为文本 |
| `utils.sleep(ms)` | `docat.utils.sleep(ms)` | 等待（可被终止打断） |

### log — 日志（进编排日志面板）

| JS | Python |
|---|---|
| `log.info(text)` | `docat.log.info(text)` |
| `log.warn(text)` | `docat.log.warn(text)` |
| `log.error(text)` | `docat.log.error(text)` |

## 示例

### JS

```js
// 设备消息驱动 Docat Motion 取放
log.info('脚本已启动')

devices.onMessage('vision_cam', async (msg) => {
  const parts = utils.toArray(msg)          // ['OK','120','40']
  if (parts[0] !== 'OK') return

  const pick  = [Number(parts[1]), Number(parts[2]), 60, 0, 0, 0]
  const place = [300, 50, 60, 0, 0, 0]
  const dock  = poses.get('home_pose', ';') ?? '0;0;0;0;0;0'  // 文本

  devices.send('motion_arm',
    'GP;' + utils.toString(pick) + ';' + utils.toString(place) + ';' + dock)

  await utils.sleep(2000)
  log.info('一轮取放完成')
})
```

### Python

```python
import docat

@docat.devices.on_message('vision_cam')
def on_msg(msg):
    parts = docat.utils.to_array(msg)
    if parts[0] != 'OK':
        return
    pick  = [float(parts[1]), float(parts[2]), 60, 0, 0, 0]
    place = [300, 50, 60, 0, 0, 0]
    dock  = docat.poses.get('home_pose', sep=';') or '0;0;0;0;0;0'
    docat.devices.send('motion_arm',
        'GP;' + docat.utils.to_string(pick) + ';' + docat.utils.to_string(place) + ';' + dock)
    docat.utils.sleep(2000)
    docat.log.info('一轮取放完成')
```

## Docat Motion 协议（内置虚拟设备）

模拟 `pick_place_tcp.py` 行为，目标真实设备已连接时指令转发执行（`moveCartesian` / 吸盘），未连接则内部模拟并回复应答：

| 命令 | 说明 | 应答 |
|---|---|---|
| `GP;抓X;抓Y;抓Z;抓Rx;抓Ry;抓Rz;放X;放Y;放Z;放Rx;放Ry;放Rz[;停靠X;...]` | 一键取放 | `GP;received;` → 执行 → `GP;reached;` |
| `MovJ;x;y;z;Rx;Ry;Rz` | 关节运动 | `MovJ;received;` → `MovJ;reached;` |
| `MovL;x;y;z;Rx;Ry;Rz` | 直线运动 | `MovL;received;` → `MovL;reached;` |
| `Suck;1|0`（兼容 on/off/true/false） | 吸盘开关 | `Suck;received;` → `Suck;reached;` |
| `PING` | 心跳应答（内容见「通用」设置） | 配置的 pong 内容 |
| 其他 | 格式错误 | `{命令};error;` |

## 第三方库

**JS**：**mathjs 已内置**——脚本可直接用全局 `math`，无需 require：

```js
log.info(String(math.sqrt(81)))              // 9
const angles = math.multiply([10, 20, 30], 0.5)
devices.send('am', 'MovL;' + utils.toString(angles) + ';0;0;0')
```

其他第三方库用 `require` 引入（`require('mathjs')` 同样可用，与全局 math 一致）；Node 内置模块（`node:path` 等）也可用。解析顺序：先按**服务端脚本目录**（其 `node_modules` 及上层）查找，找不到再回退到 **docat-server 的依赖**（`pnpm --filter docat-server add <包>` 后即可 require）。也可在脚本目录下 `npm install <包> --prefix <脚本目录>`。

**编辑器自动补全**：`const math = require('mathjs')` 后，输入 `math.` 会自动弹出该模块的导出成员（服务端实时解析模块导出，支持任意已安装包；函数成员带 `(` 快速插入）。

**Python**：`import` 天然可用——标准库直接用；第三方库安装到服务端 python 环境即可（如 `pip install pyserial`）。

**mock 模式（?mock=1）**：脚本在浏览器内模拟运行，无法加载服务端第三方库——请在真实模式运行。

## 心跳（由引擎处理，脚本无需关心）

开启心跳的设备按「通用」设置（周期/超时/阈值/内容）发送 ping 并期待应答；超时判定链路失活并自动重连（见「通用」设置）。
