/**
 * docat SDK — 开发者工具包
 * 封装与 docat-server 的 REST 和 WebSocket 通信
 */
import type {
  ApiResponse,
  AuthToken,
  DeviceConfig,
  DeviceInfo,
  DeviceState,
  JogParams,
  MoveParams,
  Script,
  User,
} from 'docat-shared/types'

export interface SdkOptions {
  serverUrl: string
  authToken?: string | null
}

export class DocatSdk {
  private serverUrl: string
  private authToken: string | null

  constructor(opts: SdkOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/$/, '')
    this.authToken = opts.authToken ?? null
  }

  // ─── Auth ──────────────────────────────────────

  async login(username: string, password: string): Promise<ApiResponse<AuthToken>> {
    return this.post('/api/auth/login', { username, password })
  }

  async logout(): Promise<ApiResponse<null>> {
    return this.post('/api/auth/logout')
  }

  async me(): Promise<ApiResponse<User>> {
    return this.get('/api/auth/me')
  }

  // ─── Devices ───────────────────────────────────

  async listDevices(): Promise<ApiResponse<DeviceConfig[]>> {
    return this.get('/api/devices')
  }

  async scanDevices(): Promise<ApiResponse<DeviceInfo[]>> {
    return this.get('/api/devices/scan')
  }

  async connectDevice(id: string): Promise<ApiResponse<unknown>> {
    return this.post(`/api/devices/${id}/connect`)
  }

  async disconnectDevice(id: string): Promise<ApiResponse<null>> {
    return this.post(`/api/devices/${id}/disconnect`)
  }

  // ─── Scripts ───────────────────────────────────

  async listScripts(): Promise<ApiResponse<Script[]>> {
    return this.get('/api/scripts')
  }

  async createScript(params: { name: string; content: string; language?: string; deviceId?: string }): Promise<ApiResponse<Script>> {
    return this.post('/api/scripts', params)
  }

  async deleteScript(id: string): Promise<ApiResponse<null>> {
    return this.delete(`/api/scripts/${id}`)
  }

  // ─── Internal ──────────────────────────────────

  setToken(token: string | null): void {
    this.authToken = token
  }

  private async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request('GET', path)
  }

  private async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request('POST', path, body)
  }

  private async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request('DELETE', path)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    const response = await fetch(`${this.serverUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    return response.json()
  }
}
