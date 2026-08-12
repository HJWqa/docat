/**
 * DobotServer 中转传输层（预留位置 — 尚未实现）
 *
 * 适用场景：串口被官方软件（DobotServer.exe）独占、直接打开串口不通的 Magician。
 * 原理（参考 find-docs/magician-controller/transport.py DobotServerClient）：
 *   官方 DobotServer 进程的 QSerialPort 持有串口，我们通过本机 UDP JSON-RPC
 *   （127.0.0.1:6600）转发指令/查询位姿。
 *
 * 请求格式：
 *   {"METHOD": "<方法名>", "PARAMS": {...}, "TARGET": "DobotServer", "id": <本机端口>}
 *   响应：{"id": <本机端口>, "result": true, "data": {...}}
 *
 * 关键方法（与串口驱动一一对应）：
 *   PRODUCT 注册      → {"PRODUCT": "Magician"}
 *   ConnectDobot      → {"METHOD": "ConnectDobot", "PARAMS": {"portName": "/dev/ttyACM0"}}
 *   GetPose           → 返回 x/y/z/r + jointAngle[4]
 *   GetAlarmsState    → 返回报警列表
 *   SetJOGCmd         → {"isJoint": 0|1, "cmd": 1..8}（0=停止）
 *   SetPTPCmd         → {"ptpMode": 0..8, "x", "y", "z", "r"}
 *   SetHOMECmd        → {"cmd": 1}
 *   SetJOGCommonParams / SetPTPCommonParams → 速度比例
 *   SetEndEffectorSuctionCup / SetEndEffectorGripper → 吸盘/夹爪
 *   SetQueuedCmdStopExec / SetQueuedCmdForceStopExec / ClearAllAlarmsState
 *
 * 实现要点：
 *   - 队列运动指令（PTP/HOME）DobotServer 常不回包，超时应视为已接受（以 GetPose 反馈为准）
 *   - 线程/进程管理：确保 DobotServer 运行（可参考 transport.py start_server）
 */
import type { MagicianOnFrame } from './MagicianSerialTransport.js'

export class DobotServerTransport {
  constructor(
    /** 串口设备名（由 DobotServer 打开），如 /dev/ttyACM0 */
    private readonly portName: string,
    private readonly onFrame: MagicianOnFrame,
    private readonly onError: (message: string) => void,
  ) {
    void this.portName
    void this.onFrame
    void this.onError
  }

  /** 打开连接（预留：TODO 实现 DobotServerClient 等效逻辑） */
  open(_timeoutMs = 10000): Promise<void> {
    return Promise.reject(new Error('服务器模式（DobotServer 中转）尚未实现 — 预留位置'))
  }

  /** 发送一帧（预留：TODO 实现 RPC 转发） */
  send(_frame: Buffer): void {
    // no-op（预留）
  }

  close(): void {
    // no-op（预留）
  }

  get isOpen(): boolean {
    return false
  }
}
