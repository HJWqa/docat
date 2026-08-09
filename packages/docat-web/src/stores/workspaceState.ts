/**
 * 编程页工作区状态持久化 — 刷新页面后恢复上次打开的设备/项目/文件/光标
 * 按设备分 key 存储：docat:programming:last:{deviceId}，切换设备互不干扰
 * 运行状态（运行中/橙线/日志）不在此存储 —— 直接向设备查询（/debugger/state）+ TCP 实时推送
 */
export interface WorkspaceState {
  deviceId: string
  projectName: string
  fileName: string
  /** monaco editor.saveViewState() 序列化结果（光标+滚动），可空 */
  viewState: unknown | null
}

const KEY_PREFIX = 'docat:programming:last'

function keyFor(deviceId: string): string {
  return `${KEY_PREFIX}:${deviceId}`
}

export function saveWorkspace(state: WorkspaceState): void {
  try {
    localStorage.setItem(keyFor(state.deviceId), JSON.stringify(state))
  } catch {
    // localStorage 不可用时忽略
  }
}

export function loadWorkspace(deviceId: string): WorkspaceState | null {
  try {
    const raw = localStorage.getItem(keyFor(deviceId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    if (!parsed.projectName) return null
    return {
      deviceId: parsed.deviceId ?? deviceId,
      projectName: parsed.projectName,
      fileName: parsed.fileName ?? '',
      viewState: parsed.viewState ?? null,
    }
  } catch {
    return null
  }
}

/** 登出时清除全部设备的工作区记录，防止串用户 */
export function clearWorkspace(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}
