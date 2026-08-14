# 编排（Orchestration）脚本 API 文档

编排功能让 **docat-server 作为多设备的中枢**：接入 TCP Server / TCP Client / UDP / 串口 / 机械臂（Docat Motion），由脚本按事件驱动把消息在设备间转发、解析、整合与决策。

## 架构与职责划分

```
设备 A ──┐                    ┌── 设备 C
设备 B ──┼─► 编排引擎 ──► 脚本 ──┤
设备 C ──┘   (连接/心跳/重连)   (业务逻辑) ─► 设备 D ...
```

| 层 | 职责 |
|---|---|
| **编排引擎**（服务端） | 设备连接 / 断线自动重连 / 心跳检测 / 消息路由 / 姿态持久化 / 脚本进程生命周期 |
| **脚本**（JS 或 Python 子进程） | 只写业务逻辑：收发消息、解析协议、坐标整合、决策 |

脚本**不负责**设备连接、重连、心跳——这些由编排引擎处理。脚本只写逻辑。

- JS 由 Node 子进程（vm 沙箱）执行；Python 由 Python 子进程执行（服务端需安装 Python）。
- Python 解释器自动探测：Windows 依次尝试 `python3` → `python` → `py -3`（取第一个可用的并缓存），Linux/macOS 使用 `python3`。全失败时运行会报「未找到 Python 解释器」，请安装 Python 并加入 PATH。
- **JS 中可直接使用裸名** `devices` / `poses` / `utils` / `log`（等价 `docat.devices` 等，写法自由）；**Python 必须** `import docat`。

## 设备类型

在编排设备页添加，同一套脚本可同时操作任意组合：

| 类型 | 适用场景 | 连接参数 |
|---|---|---|
| `tcp-server` | 上位机/传感器主动连入（docat 作为服务端） | 监听 IP + 端口 |
| `tcp-client` | docat 主动连接 PLC / 控制器 / 第三方服务 | 目标 IP + 端口 |
| `udp` | 视觉相机等广播/组播数据 | 目标 IP + 端口 |
| `serial` | 串口设备（RS232/485） | 串口号 + 波特率 |
| `docat-motion` | **内置虚拟机械臂**：模拟取放协议，可转发到真实机械臂 | 关联真实设备 id（`targetDeviceId`） |

**设备命名**：每个设备有一个唯一的 `name`（变量命名规则 `/^[A-Za-z_][A-Za-z0-9_]*$/`），脚本按名称寻址，如 `devices.send('arm', ...)`。

**姿态命名**：同规则，在「设置 → 姿态」中存储，独立于设备页姿态。

## 运行方式

- **真实模式**：脚本文件放在服务端脚本目录（「通用」设置可改，默认 `./data/orch-scripts`），脚本页选择文件 → 运行。支持 JS（`.js/.mjs/.cjs`）与 Python（`.py`）。
- **mock 模式（`?mock=1`）**：脚本在浏览器内模拟运行，可调试语法与逻辑；无法加载服务端第三方库、无法读取标定文件——请以真实模式为准。
- 运行/重新运行/终止由脚本页控制；终止 = 服务端杀掉脚本进程（含脚本再派生的子进程）。
- 顶层代码执行完毕后：**若注册了消息监听器则脚本保持运行**（事件驱动）；否则脚本自然结束。
- 编辑器支持自动补全：输入 `devices.`、`utils.`、`docat.`、`math.` 等会自动弹出成员；`require('模块')` 后会实时列出该模块导出成员。

## 事件模型（顺序处理）

设备消息 / 连接事件按到达顺序**逐个处理**（与 `pick_place_tcp.py` 风格一致）：

- JS 处理器可 `async`，await 期间后续消息排队等待，不会并发执行同一个回调。
- Python 处理器为同步函数；可用 `docat.utils.sleep` 阻塞等待（独立线程持续收消息，不丢消息）。
- 处理器内抛出的异常会被捕获并记入日志（带行号），不会拖垮整个脚本。

## API 参考（每个内置方法均附示例）

### devices — 设备收发与事件

| JS | Python | 说明 |
|---|---|---|
| `devices.send(设备名, 文本)` | `docat.devices.send(设备名, 文本)` | 按设备名发送消息；设备未连接会记错误日志 |
| `devices.onMessage(设备名, cb)` | `@docat.devices.on_message(设备名)` | 设备收到消息时回调，参数为文本 |
| `devices.onConnect(设备名, cb)` | `@docat.devices.on_connect(设备名)` | 设备连接事件（运行中才注册的处理器不会收到已发生的连接） |
| `devices.onDisconnect(设备名, cb)` | `@docat.devices.on_disconnect(设备名)` | 设备断开事件 |
| `devices.isConnected(设备名)` | `docat.devices.is_connected(设备名)` | 查询连接状态（本地快照，同步） |
| `devices.waitFor(设备名, 匹配, 超时ms?)` | `docat.devices.wait_for(设备名, 匹配, 超时ms?)` | **等待设备下一条匹配消息**（Promise，超时 reject / 抛 TimeoutError） |
| `devices.sendAndWait(设备名, 文本, 匹配, 超时ms?)` | `docat.devices.send_and_wait(设备名, 文本, 匹配, 超时ms?)` | **发送并等待匹配应答**（请求-应答一步到位） |

**匹配规则**：字符串按**前缀匹配**（如 `'GP;reached;'` 匹配 `GP;reached;` 开头的消息），或传函数 `(msg) => boolean`；不传匹配则永不匹配。默认超时 10s，超时抛错需捕获（JS try/catch、Python try/except）。waitFor 会**消费**匹配到的消息（不会同时触发 onMessage 回调）；未匹配的消息正常投递给监听器。

**JS 示例**（覆盖全部方法）：

```js
// send：按名称发送（设备未连接会记错误日志，脚本继续执行）
devices.send('B', 'START;GO;')

// onMessage：订阅设备 A 的消息（async 回调，参数为原始文本）
devices.onMessage('A', async (msg) => {
  log.info('收到 A：' + msg)
})

// onConnect / onDisconnect：链路事件
devices.onConnect('B', () => log.info('B 已连接'))
devices.onDisconnect('B', () => log.warn('B 已断开'))

// isConnected：发送前先检查连接
if (devices.isConnected('C')) {
  devices.send('C', 'READY;')
}

// waitFor：等 B 的下一条消息（前缀匹配，默认 10s 超时）
const pos = await devices.waitFor('B', 'POS;')
log.info('B 坐标：' + pos)

// waitFor：函数匹配 + 自定义超时（30s），超时进 catch
try {
  const ok = await devices.waitFor('B', (t) => t.startsWith('POS;') && t.includes('60'), 30000)
} catch (e) {
  log.error('等待超时：' + e.message)
}

// sendAndWait：发开始信号并同步等应答（第 4 参超时 15s）
const reply = await devices.sendAndWait('B', 'START;GO;', 'START;', 15000)
```

**Python 示例**（同语义）：

```python
import docat

# send
docat.devices.send('B', 'START;GO;')

# on_message（装饰器注册）
@docat.devices.on_message('A')
def on_a(msg):
    docat.log.info('收到 A：' + msg)

# on_connect / on_disconnect
@docat.devices.on_connect('B')
def on_b_connect():
    docat.log.info('B 已连接')

@docat.devices.on_disconnect('B')
def on_b_disconnect():
    docat.log.warn('B 已断开')

# is_connected
if docat.devices.is_connected('C'):
    docat.devices.send('C', 'READY;')

# wait_for：前缀匹配（默认 10s）／函数匹配 + 30s 超时
pos = docat.devices.wait_for('B', 'POS;')
pos2 = docat.devices.wait_for('B', lambda t: t.startswith('POS;') and '60' in t, 30000)

# send_and_wait：超时抛 TimeoutError，需捕获
try:
    reply = docat.devices.send_and_wait('B', 'START;GO;', 'START;', 15000)
except TimeoutError as e:
    docat.log.error('等待超时：%s' % e)
```

### poses — 姿态

姿态在「设置 → 姿态」中存储，命名须符合变量命名规则。

| JS | Python | 说明 |
|---|---|---|
| `poses.get(姿态名)` | `docat.poses.get(姿态名)` | **返回数组**：位姿 → `[x,y,z,rx,ry,rz]`；关节角 → `[j1..j6]` |
| `poses.get(姿态名, ';')` | `docat.poses.get(姿态名, sep=';')` | **传入分隔符返回文本**，如 `"100;0;50;0;0;0"` |
| `poses.list()` | `docat.poses.list()` | 姿态名列表 |

不存在的姿态返回 `undefined` / `None`。脚本运行期间增删姿态会实时推送给运行中的脚本更新本地副本。

**JS 示例**：

```js
// 数组形式：位姿 → [x, y, z, rx, ry, rz]
const p = poses.get('pick_pose')              // [100, 0, 50, 0, 0, 0]

// 文本形式：直接拼进协议字符串
const t = poses.get('pick_pose', ';')         // "100;0;50;0;0;0"
devices.send('am', 'MovL;' + t)

// list：列出全部姿态名
const names = poses.list()                    // ['pick_pose', 'place_pose', ...]

// 不存在返回 undefined → 用 ?? 给默认值
const dock = poses.get('home_pose', ';') ?? '0;0;0;0;0;0'
```

**Python 示例**：

```python
p = docat.poses.get('pick_pose')                  # [100.0, 0.0, 50.0, ...]
t = docat.poses.get('pick_pose', sep=';')         # "100.0;0.0;50.0;..."
names = docat.poses.list()                        # ['pick_pose', ...]
dock = docat.poses.get('home_pose', sep=';') or '0;0;0;0;0;0'   # None → 默认值
```

### utils — 工具

| JS | Python | 说明 |
|---|---|---|
| `utils.toArray(文本, sep=';')` | `docat.utils.to_array(文本, sep=';')` | 按分隔符解析字符串为数组（去空白/空字段，默认 `;`） |
| `utils.toString(数组, sep=';')` | `docat.utils.to_string(数组, sep=';')` | 数组拼接为文本 |
| `utils.sleep(ms)` | `docat.utils.sleep(ms)` | 等待（可被终止打断；脚本终止时抛 SystemExit） |
| `utils.wslToWin(路径)` | `docat.utils.wsl_to_win(路径)` | WSL 路径转 Windows：`/mnt/d/foo` → `D:\foo`（不匹配原样返回） |
| `utils.winToWsl(路径)` | `docat.utils.win_to_wsl(路径)` | Windows 路径转 WSL：`D:\foo` → `/mnt/d/foo`（不匹配原样返回） |

**JS 示例**：

```js
// toArray：默认 ';' 分隔；自定义分隔符
const parts = utils.toArray('OK;120;40')       // ['OK','120','40']
const nums = utils.toArray('1,2,3', ',')       // ['1','2','3']
const [x, y] = utils.toArray('120;40').map(Number)  // [120, 40]

// toString：数组拼文本
const text = utils.toString([1, 2, 3], ';')    // "1;2;3"
devices.send('B', 'START;' + text)

// sleep：等 500ms（脚本终止时立即返回/退出）
await utils.sleep(500)

// WSL ⇄ Windows 路径
const win = utils.wslToWin('/mnt/d/foo')       // "D:\\foo"
const wsl = utils.winToWsl('D:\\foo')          // "/mnt/d/foo"
```

**Python 示例**：

```python
parts = docat.utils.to_array('OK;120;40')     # ['OK','120','40']
nums = docat.utils.to_array('1,2,3', ',')     # ['1','2','3']
text = docat.utils.to_string([1, 2, 3], ';')  # "1;2;3"
docat.utils.sleep(500)                        # 阻塞 500ms（可被终止打断）
win = docat.utils.wsl_to_win('/mnt/d/foo')    # "D:\\foo"
wsl = docat.utils.win_to_wsl('D:\\foo')       # "/mnt/d/foo"
```

### utils.calib — 标定转换

解析 Dobot 标定文件（`.iwcal` / `.xml`，结构为 3×3 仿射矩阵）并在**图像坐标 ⇄ 物理坐标**间互转（与「标定辅助」方向一致：矩阵为图像→物理）。

| JS | Python | 说明 |
|---|---|---|
| `utils.calib.parseIwcaf(路径)` | `docat.utils.calib.parse_iwcaf(路径)` | 解析 .iwcal（9×float32 LE）→ 矩阵对象 |
| `utils.calib.parseXml(路径)` | `docat.utils.calib.parse_xml(路径)` | 解析 .xml 的 CalibMatrix → 矩阵对象（附 `precision` 像素精度） |
| `utils.calib.imageToWorld(m, x, y[, sep])` | `docat.utils.calib.image_to_world(m, x, y, sep=None)` | 图像→物理；给 sep 返回文本 |
| `utils.calib.worldToImage(m, wx, wy[, sep])` | `docat.utils.calib.world_to_image(m, wx, wy, sep=None)` | 物理→图像（矩阵求逆，不可逆时报错） |

矩阵对象：`{ m00, m01, m02, m10, m11, m12 }`。文件路径支持绝对路径（含 WSL `/mnt/d/...` 与 Windows `D:\...`）；相对路径按服务端脚本目录解析。**路径自动转换**：按原路径读取失败时，自动做 WSL⇄Windows 路径转换后再试一次（正常路径零额外开销），仍失败时报错并同时列出原路径与转换路径。

> ⚠️ **路径写法**：JS/Python 字符串里的 `\` 是转义符，Windows 路径请用**双反斜杠**（`"D:\\Users\\..."`）或**正斜杠**（`"D:/Users/..."`，推荐，Windows 兼容且自动转换同样识别）；单反斜杠会被吞掉甚至触发语法错误（如 `"D:\0..."` 是八进制转义，严格模式直接报错）。

**JS 示例**（覆盖全部方法）：

```js
// parseIwcaf / parseXml：解析标定文件 → 矩阵对象
const m1 = utils.calib.parseIwcaf('/mnt/d/标定/calib.iwcal')
const m2 = utils.calib.parseXml('D:/标定/calib.xml')   // 附 m2.precision 像素精度

// imageToWorld：图像 → 物理，返回数组
const [wx, wy] = utils.calib.imageToWorld(m2, 320, 240)

// imageToWorld：给分隔符返回文本，可直接拼协议
const wText = utils.calib.imageToWorld(m2, 320, 240, ';')   // "wx;wy"

// worldToImage：物理 → 图像（矩阵不可逆时报错）
const [ix, iy] = utils.calib.worldToImage(m2, wx, wy)
```

**Python 示例**（同语义）：

```python
m1 = docat.utils.calib.parse_iwcaf('/mnt/d/标定/calib.iwcal')
m2 = docat.utils.calib.parse_xml('D:/标定/calib.xml')          # 附 m2['precision']
wx, wy = docat.utils.calib.image_to_world(m2, 320, 240)        # [wx, wy]
w_text = docat.utils.calib.image_to_world(m2, 320, 240, sep=';')  # "wx;wy"
ix, iy = docat.utils.calib.world_to_image(m2, wx, wy)          # 逆变换
```

### log — 日志（进编排日志面板）

| JS | Python |
|---|---|
| `log.info(...args)` | `docat.log.info(*args)` |
| `log.warn(...args)` | `docat.log.warn(*args)` |
| `log.error(...args)` | `docat.log.error(*args)` |

多参数空格拼接：JS 中对象自动 JSON 化（同 `console.log`），Python 同 `print`。

**JS 示例**：

```js
log.info('脚本已启动')
log.warn('参数缺失，使用默认值')
log.info('坐标', { x: 1, y: 2 }, '速度', 100)   // 多参数：坐标 {"x":1,"y":2} 速度 100
try {
  await devices.waitFor('B', 'POS;')
} catch (e) {
  log.error('等待超时：' + e.message)
}
```

**Python 示例**：

```python
docat.log.info("x", 1, "y", 2)   # x 1 y 2
```

**Python 示例**：

```python
docat.log.info('脚本已启动')
docat.log.warn('参数缺失，使用默认值')
docat.log.error('等待超时：%s' % e)
```

### JS 特有：math（内置 mathjs）与 require

**mathjs 已内置**——脚本可直接用全局 `math`，无需 require：

```js
// 常用：sqrt / multiply / round / dot / add
log.info(String(math.sqrt(81)))                    // 9
const angles = math.multiply([10, 20, 30], 0.5)    // [5, 10, 15]
const mid = math.round((math.add(1.2, 2.3) / 2) * 10) / 10   // 1.8（四舍五入）
const dot = math.dot([1, 2], [3, 4])               // 11

// 结合协议：算中间点发给机械臂
devices.send('am', 'MovL;' + utils.toString(angles) + ';0;0;0')
```

其他第三方库用 `require` 引入（`require('mathjs')` 同样可用，与全局 math 一致）；Node 内置模块（`node:path` 等）也可用。解析顺序：先按**服务端脚本目录**（其 `node_modules` 及上层）查找，找不到再回退到 **docat-server 的依赖**（`pnpm --filter docat-server add <包>` 后即可 require）。也可在脚本目录下 `npm install <包> --prefix <脚本目录>`。

```js
const path = require('node:path')          // Node 内置
const { createCanvas } = require('canvas') // 脚本目录 npm 安装的第三方包
```

**Python**：`import` 天然可用——标准库直接用；第三方库安装到服务端 python 环境即可（如 `pip install pyserial`）。

```python
import math                      # 标准库
import serial                    # pip install pyserial 后可用
```

## 多设备联动示例

### 场景：三机协作（A → B → C）

**需求**：
1. 设备 A 发来**目的地坐标**
2. 向设备 B 发送**开始信号**
3. 设备 B 回发**起点坐标**
4. 整合两段坐标，转发给设备 C（如拼接成一条运动指令）

```
A ──(目的地坐标)──► docat ──(开始信号)──► B
                        ▲                    │
                        │              (起点坐标)
                        └───────┬────────────┘
                        ┌───────┘
                (起点 + 目的地 整合)
                        │
                        ▼
                      C（执行）
```

**JS 实现**：

```js
// 设备 A 发来目的地坐标（如 "DEST;120;40;60"）
devices.onMessage('A', async (msg) => {
  const dest = utils.toArray(msg)                    // ['DEST','120','40','60']
  if (dest[0] !== 'DEST') return                     // 协议头校验
  const [dx, dy, dz] = dest.slice(1, 4).map(Number)  // 目的地坐标

  // 向 B 发送开始信号，并同步等待它回发起点坐标（前缀匹配 "START;"）
  // 超时默认 10s，可传第四个参数调整
  let start
  try {
    start = await devices.sendAndWait('B', 'START;GO;', 'START;')
  } catch (e) {
    log.error('B 未在超时内应答：' + e.message)
    return
  }
  const [sx, sy, sz] = utils.toArray(start).slice(1, 4).map(Number)  // 起点坐标

  // 整合：起点 + 目的地 拼成 C 的协议（如 MovL;起点x;起点y;起点z;目的地x;...）
  const msgToC = utils.toString(['MovL', sx, sy, sz, dx, dy, dz], ';')
  devices.send('C', msgToC)
  log.info(`已整合并转发给 C：${msgToC}`)
})
```

**Python 实现**（同语义）：

```python
import docat

@docat.devices.on_message('A')
def on_dest(msg):
    dest = docat.utils.to_array(msg)
    if dest[0] != 'DEST':
        return
    dx, dy, dz = [float(v) for v in dest[1:4]]

    try:
        start = docat.devices.send_and_wait('B', 'START;GO;', 'START;')
    except TimeoutError as e:
        docat.log.error('B 未在超时内应答：%s' % e)
        return
    sx, sy, sz = [float(v) for v in docat.utils.to_array(start)[1:4]]

    msg_to_c = docat.utils.to_string(['MovL', sx, sy, sz, dx, dy, dz], ';')
    docat.devices.send('C', msg_to_c)
    docat.log.info('已整合并转发给 C：%s' % msg_to_c)
```

**要点**：
- `sendAndWait`（请求-应答一步到位）适合「发信号 → 等回坐标」；也可拆成 `devices.send('B', ...)` + `devices.waitFor('B', 'START;')`。
- 匹配用**前缀**（`'START;'` 能匹配 `START;10;20;30`），协议头稳定时最省事；不稳定时用函数匹配。
- 协议解析用 `utils.toArray(msg)` + `map(Number)`；拼装用 `utils.toString([...], ';')`。
- 消息顺序处理：回调内 await 期间 A 的后续消息排队，不会重入。

### 场景：视觉 + 标定 + 机械臂（坐标转换联动）

视觉给图像坐标 → 标定矩阵转物理坐标 → 驱动 Docat Motion：

```js
const calib = utils.calib.parseXml('/mnt/d/标定/calib.xml')
devices.onMessage('vision_cam', async (msg) => {
  const [ix, iy] = utils.toArray(msg).map(Number)
  const [wx, wy] = utils.calib.imageToWorld(calib, ix, iy)
  devices.send('motion_arm',
    'MovL;' + utils.toString([wx, wy, 60, 0, 0, 0], ';'))
})
```

Python 同语义：`docat.utils.calib.parse_xml(...)` / `image_to_world(...)`。

### 场景：完整取放流程（消息驱动 + 姿态 + 多步应答）

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

Python 同语义：

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
| `GP;抓X;抓Y;抓Z;抓Rx;抓Ry;抓Rz;放X;放Y;放Z;放Rx;放Ry;放Rz[;停靠X;...]` | 一键取放（抓/放/停靠三段，各 6 个数值） | `GP;received;` → 执行 → `GP;reached;` |
| `MovJ;x;y;z;Rx;Ry;Rz` | 关节运动 | `MovJ;received;` → `MovJ;reached;` |
| `MovL;x;y;z;Rx;Ry;Rz` | 直线运动 | `MovL;received;` → `MovL;reached;` |
| `Suck;1\|0`（兼容 on/off/true/false） | 吸盘开关 | `Suck;received;` → `Suck;reached;` |
| `PING` | 心跳应答（内容见「通用」设置） | 配置的 pong 内容 |
| 其他 | 格式错误 | `{命令};error;` |

命令大小写不敏感、行尾分号可省略。GP 执行期间会额外上报过程消息（`吸盘 开/关`、`GP 完成 当前位姿 (...)`），可用于日志观察。

**示例**（同步等待每个阶段的应答）：

```js
devices.send('am', 'GP;100;0;60;0;0;0;300;50;60;0;0;0')
await devices.waitFor('am', 'GP;received;')   // 已接收
await devices.waitFor('am', 'GP;reached;')    // 执行完成
log.info('取放完成')
```

## 心跳与自动重连（引擎处理，脚本无需关心）

- 开启心跳的设备按「通用」设置（周期/超时/阈值/内容）发送 ping 并期待应答；连续无应答判定链路失活。
- 断线自动重连：指数退避（1s → 2s → 4s … 上限 30s），受「通用」设置的重连次数/时长上限约束；手动断开不自动重连。
- 连接/断开会触发 `onConnect` / `onDisconnect` 事件并更新 `isConnected` 快照。

## 常见问题

| 问题 | 说明 |
|---|---|
| 设备未连接时 send | 记错误日志（`发送失败：设备未连接 → ...`），脚本继续执行；可用 `isConnected` 先行判断 |
| waitFor/sendAndWait 超时 | 默认 10s，传第 4 个参数调整；超时抛错需捕获（JS try/catch、Python try/except） |
| Windows 路径报错 | 见「utils.calib」的路径写法警告：用正斜杠或双反斜杠 |
| 脚本报错位置 | 日志会带用户代码行号/列号（JS 从第 3 行起为用户代码） |
| 脚本终止 | 服务端杀进程树（含脚本再派生的子进程），JS 的 setTimeout/interval 一并清理 |
