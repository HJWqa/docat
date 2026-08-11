// 设备设置板块的输入校验工具（对齐 OpenDobot46 的 ruler 校验规则）

// ─── 按机型最大负载（单位 g，前端内部统一用 g）───────────
// 参照 OpenDobot46 maxLoadValueConfiguration.ts：MG6/E6/桌面机型 750g，协作机型按额定负载
const MAX_LOAD_G: Record<string, number> = {
  MG6: 750,
  E6: 750,
  M1PRO: 3000,
  NC02: 2000,
  NC02S: 2000,
  NC02L: 2000,
  NC05: 5000,
  NOVA2: 2000,
  NOVA5: 5000,
  CR3: 3000,
  CR3L: 3000,
  CR3V: 3000,
  CR3V2: 3000,
  CR3A: 3000,
  CR3AL: 3000,
  CR5: 5000,
  CR5V: 5000,
  CR5V2: 5000,
  CR5A: 5000,
  CR7: 7000,
  CR7V: 7000,
  CR7V2: 7000,
  CR10: 10000,
  CR10V: 10000,
  CR10V2: 10000,
  CR10A: 10000,
  CR12: 12000,
  CR12V: 12000,
  CR12V2: 12000,
  CR12A: 12000,
  CR16: 16000,
  CR16V: 16000,
  CR16V2: 16000,
  CR16A: 16000,
  CR16AL: 16000,
  CR20: 20000,
  CR20V: 20000,
  CR20V2: 20000,
  CR20A: 20000,
  CR30: 30000,
}

/** 按设备型号（type / name 归一化后）返回最大负载（g），未知机型返回 null（不限制） */
export function maxLoadGramsForDevice(raw: string | undefined): number | null {
  const key = String(raw || '').toUpperCase().replace(/\s+/g, '')
  if (!key) return null
  const hit = Object.keys(MAX_LOAD_G).find(k => key.includes(k))
  return hit ? MAX_LOAD_G[hit] : null
}

/** 校验负载重量（g）：>0 且不超过机型最大负载 */
export function validateLoadWeight(loadValue: number, deviceType: string | undefined): string | null {
  if (!Number.isFinite(loadValue) || loadValue < 0) return '重量必须 ≥ 0'
  const max = maxLoadGramsForDevice(deviceType)
  if (max != null && loadValue > max) return `超过该机型最大负载 ${max}g`
  return null
}

/** 质心偏移量（mm）：绝对值不超过 1000（对齐 OpenDobot46 offsetExpCheck） */
export function validateOffset(offset: number): string | null {
  if (!Number.isFinite(offset)) return '质心偏移必须是数字'
  if (Math.abs(offset) > 1000) return '质心偏移范围 ±1000mm'
  return null
}

/** 名称：非空且 ≤ 20 字符（对齐 aliasExpCheck） */
export function validateAlias(name: string): string | null {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return '名称不能为空'
  if (trimmed.length > 20) return '名称不能超过 20 个字符'
  return null
}

// ─── 通讯设置校验 ────────────────────────────

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function validateIpv4(value: string, label: string): string | null {
  const v = String(value ?? '').trim()
  if (!v) return `${label}不能为空`
  const m = IPV4_RE.exec(v)
  if (!m) return `${label}格式不正确`
  const parts = m.slice(1).map(Number)
  if (parts.some(p => p < 0 || p > 255)) return `${label}超出范围 0-255`
  return null
}

export function validateIpv4Optional(value: string, label: string): string | null {
  const v = String(value ?? '').trim()
  if (!v) return null
  return validateIpv4(v, label)
}

/** SSID ≤ 32 字节（对齐 OpenDobot46 byteLenghCheck <= 32） */
export function validateSsid(ssid: string): string | null {
  const v = String(ssid ?? '').trim()
  if (!v) return 'SSID 不能为空'
  if (new TextEncoder().encode(v).length > 32) return 'SSID 不能超过 32 字节'
  return null
}

/** 密码：1~22 字节（空密码允许，仅当启用 WiFi 时检查） */
export function validateWifiPassword(passWd: string): string | null {
  const v = String(passWd ?? '')
  const len = new TextEncoder().encode(v).length
  if (len > 22) return '密码不能超过 22 字节'
  return null
}

// ─── 系统时间校验 ────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/

export function validateDate(value: string): string | null {
  if (!DATE_RE.test(String(value ?? ''))) return '日期格式应为 YYYY-MM-DD'
  return null
}

export function validateTime(value: string): string | null {
  if (!TIME_RE.test(String(value ?? ''))) return '时间格式应为 HH:mm:ss'
  return null
}

export function validateTimeZone(value: string): string | null {
  const v = String(value ?? '').trim()
  if (!v) return '时区不能为空'
  try {
    new Intl.DateTimeFormat('en', { timeZone: v })
  } catch {
    return '时区名无效（应为 IANA 名，如 Asia/Shanghai）'
  }
  return null
}

// ─── 用户密码校验 ────────────────────────────

export function validateUserPassword(password: string, requireNonEmpty = false): string | null {
  const v = String(password ?? '')
  if (requireNonEmpty && !v) return '密码不能为空'
  if (v && v.length < 4) return '密码至少 4 位'
  if (v && v.length > 64) return '密码不能超过 64 位'
  return null
}
