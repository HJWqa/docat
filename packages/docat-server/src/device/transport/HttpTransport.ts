/**
 * HTTP 传输层 — 封装与设备 HTTP 端口的通信
 * 从 OpenDobot46 dobotSerial.ts + axios.ts 提取，去单例化
 * @see OpenDobot46/src.dobotlink/http/dobotSerial.ts
 * @see OpenDobot46/src.dobotlink/http/axios.ts
 */
import type { TransportParams, TransportReply } from 'docat-shared/types'

export type HttpMethod = 'get' | 'post' | 'put' | 'delete'

interface InternalRequestParams {
  method: HttpMethod
  url: string
  host: string
  port: number
  params?: unknown
  timeout?: number
}

export class HttpTransport {
  private host: string
  private port: number
  private defaultTimeout: number

  constructor(host: string, port: number, defaultTimeout: number = 3000) {
    this.host = host
    this.port = port
    this.defaultTimeout = defaultTimeout
  }

  /** 发送 HTTP 请求到设备 */
  async send(params: TransportParams): Promise<TransportReply> {
    const { method, url, params: data, timeout } = params
    try {
      const result = await this.request({
        method: method as HttpMethod,
        url,
        host: this.host,
        port: this.port,
        params: data,
        timeout: timeout ?? this.defaultTimeout,
      })
      return { status: true, code: 0, data: result }
    } catch (error) {
      return this.handleError(error)
    }
  }

  /** 内部 fetch 封装 */
  private async request(params: InternalRequestParams): Promise<unknown> {
    const { method, url, host, port, timeout } = params
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const upperMethod = method.toUpperCase()
    // GET/HEAD 不应带 body（部分控制器会因此返回异常）
    const canHaveBody = upperMethod !== 'GET' && upperMethod !== 'HEAD'
    const hasBody = canHaveBody && params.params !== undefined && params.params !== null

    try {
      const response = await fetch(`http://${host}:${port}${url}`, {
        method: upperMethod,
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(params.params) : undefined,
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>
        const err = new Error(
          (errorBody.errormessage as string) || (errorBody.errorMsg as string) || `HTTP ${response.status}`
        ) as Error & { status: number; data: unknown }
        err.status = response.status
        err.data = errorBody
        throw err
      }

      // 部分接口可能返回空 body
      const text = await response.text()
      if (!text) return null
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 错误处理 — 兼容原 OpenDobot46 错误码体系 */
  private handleError(error: unknown): TransportReply {
    const err = error as Error & { status?: number; data?: unknown; response?: { status: number; data: unknown } }

    if (err.message?.includes('aborted') || err.message?.includes('timeout')) {
      return { status: false, code: 4001, message: '请求超时' }
    }

    // 501 Not Implemented / 405 Method Not Allowed（如 E6 不支持 customPose）
    if (err.status === 501 || err.status === 405) {
      return { status: false, code: 4002, message: err.message }
    }

    if (err.status === 400) {
      return { status: false, code: 4003, message: err.message }
    }

    if (err.status === 500) {
      const data = err.data as Record<string, unknown> | undefined
      return {
        status: false,
        code: (data?.errID as number) || (data?.code as number) || 4004,
        message: err.message,
      }
    }

    return { status: false, code: 4000, message: err.message }
  }
}

/** 工厂：创建设备各端口对应的 HTTP 传输实例 */
export function createDeviceTransports(ip: string) {
  return {
    /** 主通道 — 设备控制 */
    main: new HttpTransport(ip, 22000),
    /** DobotPlus 插件 */
    plus: new HttpTransport(ip, 22001),
    /** 固件更新 */
    firmware: new HttpTransport(ip, 22002),
  }
}
