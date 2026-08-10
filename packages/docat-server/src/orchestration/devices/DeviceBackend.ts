/**
 * 编排设备后端接口 — 每种类型的连接/收发实现
 */
export interface OrchDeviceBackend {
  /** 设备 id */
  readonly id: string
  /** 连接（幂等）；失败返回错误信息 */
  connect(): Promise<{ ok: boolean; error?: string }>
  /** 断开（幂等） */
  disconnect(): Promise<void>
  /** 发送文本消息；失败返回 false（由调用方记日志） */
  send(text: string): Promise<boolean>
  /** 释放资源（对象销毁前调用，如 TCP 监听关闭） */
  dispose(): void
}
