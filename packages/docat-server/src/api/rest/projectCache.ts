/**
 * 控制器项目缓存
 * 缓存打开过的项目文件内容与项目列表，命中缓存可秒开工程，再由客户端后台刷新最新内容。
 *
 * 目录结构：
 *   <cacheDir>/<deviceId>/projects.json            — 项目列表快照
 *   <cacheDir>/<deviceId>/<projectName>.json       — 项目完整详情（含全部文件内容 + cachedAt）
 *
 * 全部使用 node:path / node:fs，Windows / Linux 通用；退出/重启不清理，
 * 仅由 trimCachedProjects 按容量上限淘汰最旧条目。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let cacheRoot = ''

export function initProjectCache(cacheDir: string): void {
  cacheRoot = cacheDir
  mkdirSync(cacheDir, { recursive: true })
}

/** 路径段安全校验（deviceId / projectName），防止目录穿越 */
function assertCacheSegment(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error(`${label}不合法`)
  }
  return value
}

function deviceDir(deviceId: string): string {
  const dir = join(cacheRoot, assertCacheSegment(deviceId, '设备ID'))
  mkdirSync(dir, { recursive: true })
  return dir
}

function projectFile(deviceId: string, projectName: string): string {
  return join(deviceDir(deviceId), `${assertCacheSegment(projectName, '工程名')}.json`)
}

export interface CachedProject<T> {
  cachedAt: string
  detail: T
}

export function readCachedProject<T>(deviceId: string, projectName: string): CachedProject<T> | null {
  try {
    const file = projectFile(deviceId, projectName)
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as CachedProject<T>
    if (!parsed || typeof parsed.cachedAt !== 'string' || !parsed.detail) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCachedProject<T>(deviceId: string, projectName: string, detail: T): void {
  const file = projectFile(deviceId, projectName)
  const data: CachedProject<T> = { cachedAt: new Date().toISOString(), detail }
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, file)
}

export function deleteCachedProject(deviceId: string, projectName: string): void {
  try {
    rmSync(projectFile(deviceId, projectName), { force: true })
  } catch {
    // ignore
  }
}

export function renameCachedProject(deviceId: string, oldName: string, newName: string): void {
  try {
    const from = projectFile(deviceId, oldName)
    const to = projectFile(deviceId, newName)
    if (existsSync(from) && from !== to) renameSync(from, to)
  } catch {
    // ignore
  }
}

/** 每个设备保留最近 N 个项目（按 cachedAt 排序），超限删除最旧 */
export function trimCachedProjects(deviceId: string, max: number): void {
  if (max <= 0) return
  try {
    const dir = deviceDir(deviceId)
    const entries = readdirSync(dir)
      .filter(name => name.endsWith('.json') && name !== 'projects.json')
      .map(name => {
        const file = join(dir, name)
        let cachedAt: number
        try {
          const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { cachedAt?: string }
          const parsedTime = parsed?.cachedAt ? new Date(parsed.cachedAt).getTime() : 0
          cachedAt = Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : statSync(file).mtimeMs
        } catch {
          cachedAt = statSync(file).mtimeMs
        }
        return { file, cachedAt }
      })
      .sort((a, b) => b.cachedAt - a.cachedAt)
    for (const entry of entries.slice(max)) rmSync(entry.file, { force: true })
  } catch {
    // ignore
  }
}

export interface CachedProjectList<T> {
  cachedAt: string
  entries: T[]
}

const LIST_FILE = 'projects.json'

export function readCachedProjectList<T>(deviceId: string): CachedProjectList<T> | null {
  try {
    const file = join(deviceDir(deviceId), LIST_FILE)
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as CachedProjectList<T>
    if (!parsed || typeof parsed.cachedAt !== 'string' || !Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCachedProjectList<T>(deviceId: string, entries: T[]): void {
  try {
    const file = join(deviceDir(deviceId), LIST_FILE)
    const data: CachedProjectList<T> = { cachedAt: new Date().toISOString(), entries }
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, file)
  } catch {
    // ignore
  }
}

/** 从项目列表快照中剔除指定项目（无快照/项目不存在时忽略） */
export function removeCachedProjectListEntry(deviceId: string, projectName: string): void {
  try {
    const list = readCachedProjectList<{ name: string }>(deviceId)
    if (!list) return
    const entries = list.entries.filter(entry => entry.name !== projectName)
    if (entries.length === list.entries.length) return
    writeCachedProjectList(deviceId, entries)
  } catch {
    // ignore
  }
}
