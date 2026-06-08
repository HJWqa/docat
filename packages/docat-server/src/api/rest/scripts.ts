/**
 * 脚本管理 REST API
 * /api/scripts — 本地脚本 CRUD + 控制器项目部署/运行
 */
import type { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../../db/index.js'
import { authMiddleware, requireOperator } from '../../auth/auth.js'
import { HttpTransport } from '../../device/transport/HttpTransport.js'
import { SftpTransport } from '../../device/transport/SftpTransport.js'
import type { DevicePool } from '../../device/DevicePool.js'
import type { ApiResponse, Script, ScriptLanguage } from 'docat-shared/types'

interface ScriptDeployBody {
  deviceId: string
  projectName?: string
}

interface ScriptRunBody extends ScriptDeployBody {
  line?: number
}

interface ControllerProjectFile {
  name: string
  content: string
}

interface ScriptDeployResult {
  projectName: string
  projectPath: string
  files: string[]
}

interface ScriptRunResult {
  deployed: ScriptDeployResult
  preCompile: unknown
  debugger: unknown
}

interface DebuggerBreakPointBody {
  opCode?: number
  line?: number[][]
}

const SCRIPT_LANGUAGES = ['lua', 'python', 'blockly'] as const
const PROJECT_ROOT = '/developOnly/project'
const POINT_CATEGORY_DEFAULT = '[{"id":"FIXED_DEFAULT","groupName":"","points":[]}]'
const EMPTY_SCRATCH_XML = 'data:application/zip;base64,UEsDBAoAAAAIALQix1yXg+vzfwAAAJEAAAAPAAAAc2NyYXRjaERhdGEueG1ss6nIzVEA4rxiW6WMkpICK3398vJyvXJjvfyidH1DS0tL/YqMktwcJTubssSizMSknNRiOxt9JHZSTn5ytkJJZUGqrVJqWWpeSXxxSWJRiZJCZoqtUrpzXqyFj4VjpKl1tl9cdoRrhWKkkkKFrZKJqZJCJZgCmgY2AkgD3WEHAFBLAQIUAAoAAAAIALQix1yXg+vzfwAAAJEAAAAPAAAAAAAAAAAAAAAAAAAAAABzY3JhdGNoRGF0YS54bWxQSwUGAAAAAAEAAQA9AAAArAAAAAAA'

interface ControllerProjectSummary {
  name: string
  path: string
  language: ScriptLanguage
  size: number
  modifiedAt: string
  files: number
}

interface ControllerProjectFileDetail {
  name: string
  path: string
  size: number
  modifyTime: number
  rights?: {
    user?: string
    group?: string
    other?: string
  }
  content: string
  editable: boolean
  language: 'lua' | 'python' | 'json' | 'xml' | 'text'
}

interface ControllerProjectDetail extends ControllerProjectSummary {
  prj: unknown
  fileList: ControllerProjectFileDetail[]
}

interface RecentProject {
  projectName: string
  projectPath: string
  language: ScriptLanguage
  openedAt: string
}

export function scriptRoutes(app: FastifyInstance, pool: DevicePool): void {
  function getDeviceIp(deviceId: string): string | null {
    const online = pool.getDevice(deviceId)
    if (online) return online.driver.ip

    const db = getDb()
    const device = db.prepare('SELECT ip FROM devices WHERE id = ?').get(deviceId) as { ip: string } | undefined
    return device?.ip ?? null
  }

  function normalizeLanguage(language: string | undefined): ScriptLanguage {
    const value = String(language || 'lua').toLowerCase()
    return (SCRIPT_LANGUAGES as readonly string[]).includes(value) ? value as ScriptLanguage : 'lua'
  }

  function assertProjectName(name: string): string {
    const value = String(name || '').trim()
    if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
      throw new Error('工程名不合法')
    }
    if (value.length > 100) throw new Error('工程名过长')
    return value
  }

  function assertProjectFileName(name: string): string {
    const value = String(name || '').trim()
    if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
      throw new Error('文件名不合法')
    }
    if (value.length > 120) throw new Error('文件名过长')
    return value
  }

  function projectPath(projectName: string): string {
    return `${PROJECT_ROOT}/${assertProjectName(projectName)}`
  }

  function projectFilePath(projectName: string, fileName: string): string {
    return `${projectPath(projectName)}/${assertProjectFileName(fileName)}`
  }

  function normalizeProjectName(name: string, language: ScriptLanguage): string {
    const cleanName = assertProjectName(name)
    if (language === 'python') return cleanName.startsWith('python_') ? cleanName : `python_${cleanName}`
    if (language === 'blockly') return cleanName.startsWith('blockly_') ? cleanName : `blockly_${cleanName}`
    return cleanName
  }

  function inferProjectLanguage(name: string, prj: Record<string, unknown> | null, fileNames: string[]): ScriptLanguage {
    if (name.startsWith('python_') || prj?.type === 'Python' || prj?.main) return 'python'
    if (name.startsWith('blockly_') || fileNames.includes('scratch.xml')) return 'blockly'
    return 'lua'
  }

  function languageFromFileName(name: string): ControllerProjectFileDetail['language'] {
    if (name.endsWith('.lua')) return 'lua'
    if (name.endsWith('.py')) return 'python'
    if (name.endsWith('.json')) return 'json'
    if (name.endsWith('.xml')) return 'xml'
    return 'text'
  }

  function isEditableProjectFile(name: string): boolean {
    return !['global.sym', 'globalsDeclaration.lua'].includes(name)
  }

  function defaultProjectFiles(language: ScriptLanguage): ControllerProjectFile[] {
    if (language === 'python') {
      return [
        { name: 'prj.json', content: JSON.stringify({ main: 'main.py', teach: 'point.json', var: 'var.py', submain: [], type: 'Python' }) },
        { name: 'main.py', content: '# version: Python3\n' },
        { name: 'var.py', content: '# version: Python3\n' },
        { name: 'point.json', content: '[]' },
        { name: 'pointCategory.json', content: POINT_CATEGORY_DEFAULT },
        { name: 'point.json.lua', content: '' },
        { name: 'point.json.py', content: '' },
      ]
    }

    const files = [
      { name: 'prj.json', content: JSON.stringify({ cpus: ['src0.lua'], global: 'global.lua', teach_point: 'point.json', type: 'Lua' }) },
      { name: 'src0.lua', content: language === 'blockly' ? '\n' : '-- Lua 5.4.4\n' },
      { name: 'global.lua', content: language === 'blockly' ? '' : '-- Lua 5.4.4\n' },
      { name: 'point.json', content: '[]' },
      { name: 'pointCategory.json', content: POINT_CATEGORY_DEFAULT },
      { name: 'point.json.lua', content: '' },
      { name: 'point.json.py', content: '' },
    ]
    if (language === 'blockly') files.push({ name: 'scratch.xml', content: EMPTY_SCRATCH_XML })
    return files
  }

  function buildProjectName(script: Script, explicitName?: string): string {
    const prefix = script.language === 'python' ? 'python_' : script.language === 'blockly' ? 'blockly_' : 'script_'
    const rawName = (explicitName || script.name || script.id)
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80)
    const name = rawName || script.id
    return name.startsWith(prefix) ? name : `${prefix}${name}`
  }

  function buildControllerProjectFiles(script: Script): ControllerProjectFile[] {
    if (script.language === 'python') {
      return [
        {
          name: 'prj.json',
          content: JSON.stringify({
            main: 'main.py',
            teach: 'point.json',
            var: 'var.py',
            submain: [],
            type: 'Python',
          }),
        },
        { name: 'main.py', content: script.content || '' },
        { name: 'var.py', content: '' },
        { name: 'point.json', content: '[]' },
        { name: 'pointCategory.json', content: '[]' },
      ]
    }

    if (script.language === 'blockly') {
      throw new Error('Blockly 项目部署暂未实现')
    }

    return [
      {
        name: 'prj.json',
        content: JSON.stringify({
          cpus: ['src0.lua'],
          global: 'global.lua',
          teach_point: 'point.json',
          type: 'Lua',
        }),
      },
      { name: 'src0.lua', content: script.content || '' },
      { name: 'global.lua', content: '' },
      { name: 'point.json', content: '[]' },
      { name: 'pointCategory.json', content: '[]' },
    ]
  }

  async function deployScriptProject(script: Script, deviceId: string, projectName?: string): Promise<ScriptDeployResult> {
    const ip = getDeviceIp(deviceId)
    if (!ip) throw new Error('设备不存在')

    const resolvedName = buildProjectName(script, projectName)
    const projectPath = `/developOnly/project/${resolvedName}`
    const files = buildControllerProjectFiles(script)
    const sftp = new SftpTransport(ip)
    await sftp.writeTexts(files.map(file => ({
      path: `${projectPath}/${file.name}`,
      content: file.content,
    })))

    const db = getDb()
    db.prepare('UPDATE scripts SET deviceId = ?, updatedAt = ? WHERE id = ?')
      .run(deviceId, new Date().toISOString(), script.id)

    return {
      projectName: resolvedName,
      projectPath,
      files: files.map(file => file.name),
    }
  }

  async function sendDebugger(deviceId: string, url: string, params?: unknown, method: 'get' | 'post' = 'post'): Promise<unknown> {
    const ip = getDeviceIp(deviceId)
    if (!ip) throw new Error('设备不存在')

    const http = new HttpTransport(ip, 22000, 10000)
    const result = await http.send({
      method,
      url,
      portName: ip,
      params,
      timeout: 10000,
    })
    if (!result.status) throw new Error(result.message || `Debugger request failed: ${url}`)

    const data = result.data as Record<string, unknown> | undefined
    if (data && data.status === false) {
      throw new Error(formatDebuggerPayloadError(data, `Debugger rejected: ${url}`))
    }
    return result.data
  }

  function formatDebuggerPayloadError(payload: Record<string, unknown>, fallback: string): string {
    const parts: string[] = []
    const report = payload.report
    const message = payload.message ?? payload.errorMsg
    const code = payload.code ?? payload.errorCode

    if (Array.isArray(report)) {
      parts.push(...report.map(item => String(item)).filter(Boolean))
    } else if (report) {
      parts.push(String(report))
    }

    if (Array.isArray(message)) {
      parts.push(...message.map(item => String(item)).filter(Boolean))
    } else if (message) {
      parts.push(String(message))
    }

    if (code !== undefined && code !== null) {
      parts.push(`code: ${String(code)}`)
    }

    return parts.length ? [...new Set(parts)].join('\n') : fallback
  }

  async function preCompileProject(deviceId: string, projectName: string): Promise<unknown> {
    const data = await sendDebugger(deviceId, '/debugger/preCompile', { project: projectName })
    if (data && typeof data === 'object') {
      const payload = data as Record<string, unknown>
      const failed = payload.result === false ||
        (Array.isArray(payload.result) && payload.result.some(item => item === false)) ||
        !payload.unLines
      if (failed) {
        throw new Error(formatDebuggerPayloadError(payload, '脚本预编译失败'))
      }
    }
    return data
  }

  async function startProject(deviceId: string, projectName: string, language: ScriptLanguage, line = 0): Promise<unknown> {
    if (language === 'python') {
      return sendDebugger(deviceId, '/debugger/start', {
        project: projectName,
        isDebug: false,
        timeout: 20000,
      })
    }

    return sendDebugger(deviceId, '/debugger/start', {
      project: projectName,
      type: 0,
      line,
      blocklyLines: [[]],
    })
  }

  function getProjectSftp(deviceId: string): SftpTransport {
    const ip = getDeviceIp(deviceId)
    if (!ip) throw new Error('设备不存在')
    return new SftpTransport(ip)
  }

  async function readProjectPrj(sftp: SftpTransport, projectName: string): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await sftp.readText(projectFilePath(projectName, 'prj.json'))) as Record<string, unknown>
    } catch {
      return null
    }
  }

  async function summarizeProject(sftp: SftpTransport, projectName: string): Promise<ControllerProjectSummary> {
    const entries = await sftp.list(projectPath(projectName))
    const files = entries.filter(entry => entry.type === '-')
    const prj = await readProjectPrj(sftp, projectName)
    const language = inferProjectLanguage(projectName, prj, files.map(file => file.name))
    const modifiedAt = new Date(Math.max(0, ...files.map(file => file.modifyTime || 0))).toISOString()
    return {
      name: projectName,
      path: projectPath(projectName),
      language,
      size: files.reduce((total, file) => total + (file.size || 0), 0),
      modifiedAt,
      files: files.length,
    }
  }

  async function readProjectDetail(sftp: SftpTransport, projectName: string): Promise<ControllerProjectDetail> {
    const summary = await summarizeProject(sftp, projectName)
    const entries = (await sftp.list(projectPath(projectName)))
      .filter(entry => entry.type === '-')
      .sort((a, b) => {
        const important = ['prj.json', 'src0.lua', 'main.py', 'global.lua', 'var.py', 'scratch.xml', 'point.json', 'pointCategory.json']
        const ai = important.indexOf(a.name)
        const bi = important.indexOf(b.name)
        if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
        return a.name.localeCompare(b.name)
      })
    const contents = await sftp.readTexts(entries.map(entry => projectFilePath(projectName, entry.name)))
    const prj = await readProjectPrj(sftp, projectName)
    return {
      ...summary,
      prj,
      fileList: entries.map(entry => ({
        name: entry.name,
        path: projectFilePath(projectName, entry.name),
        size: entry.size,
        modifyTime: entry.modifyTime,
        rights: entry.rights,
        content: contents.get(projectFilePath(projectName, entry.name)) ?? '',
        editable: isEditableProjectFile(entry.name),
        language: languageFromFileName(entry.name),
      })),
    }
  }

  function rememberRecentProject(userId: string, deviceId: string, project: ControllerProjectSummary): void {
    const db = getDb()
    db.prepare(`
      INSERT INTO recent_projects (userId, deviceId, projectName, projectPath, language, openedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, deviceId, projectName)
      DO UPDATE SET projectPath = excluded.projectPath, language = excluded.language, openedAt = excluded.openedAt
    `).run(userId, deviceId, project.name, project.path, project.language, new Date().toISOString())
  }

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/projects',
    async (request, reply): Promise<ApiResponse<ControllerProjectSummary[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const sftp = getProjectSftp(request.params.id)
        const entries = await sftp.list(PROJECT_ROOT)
        const projects = await Promise.all(
          entries
            .filter(entry => entry.type === 'd')
            .map(entry => summarizeProject(sftp, entry.name).catch(() => null))
        )
        return { success: true, data: projects.filter(Boolean) as ControllerProjectSummary[] }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/projects/recent',
    async (request, reply): Promise<ApiResponse<RecentProject[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const db = getDb()
        const rows = db.prepare(`
          SELECT projectName, projectPath, language, openedAt
          FROM recent_projects
          WHERE userId = ? AND deviceId = ?
          ORDER BY openedAt DESC
          LIMIT 20
        `).all(request.auth!.userId, request.params.id) as RecentProject[]
        return { success: true, data: rows }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: { name: string; language?: string } }>(
    '/api/devices/:id/projects',
    async (request, reply): Promise<ApiResponse<ControllerProjectDetail>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply

        const language = normalizeLanguage(request.body.language)
        const name = normalizeProjectName(request.body.name, language)
        const sftp = getProjectSftp(request.params.id)
        const path = projectPath(name)
        await sftp.ensureDir(path)
        await sftp.writeTexts(defaultProjectFiles(language).map(file => ({
          path: `${path}/${file.name}`,
          content: file.content,
          mode: 0o777,
        })))
        const detail = await readProjectDetail(sftp, name)
        rememberRecentProject(request.auth!.userId, request.params.id, detail)
        return { success: true, data: detail }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string; projectName: string } }>(
    '/api/devices/:id/projects/:projectName',
    async (request, reply): Promise<ApiResponse<ControllerProjectDetail>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const sftp = getProjectSftp(request.params.id)
        const detail = await readProjectDetail(sftp, request.params.projectName)
        rememberRecentProject(request.auth!.userId, request.params.id, detail)
        return { success: true, data: detail }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.delete<{ Params: { id: string; projectName: string } }>(
    '/api/devices/:id/projects/:projectName',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const sftp = getProjectSftp(request.params.id)
        await sftp.deleteDir(projectPath(request.params.projectName))
        const db = getDb()
        db.prepare('DELETE FROM recent_projects WHERE deviceId = ? AND projectName = ?')
          .run(request.params.id, request.params.projectName)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string; projectName: string }; Body: { name: string } }>(
    '/api/devices/:id/projects/:projectName/rename',
    async (request, reply): Promise<ApiResponse<ControllerProjectDetail>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const oldName = assertProjectName(request.params.projectName)
        const newName = assertProjectName(request.body.name)
        const sftp = getProjectSftp(request.params.id)
        await sftp.rename(projectPath(oldName), projectPath(newName))
        const detail = await readProjectDetail(sftp, newName)
        rememberRecentProject(request.auth!.userId, request.params.id, detail)
        const db = getDb()
        db.prepare('DELETE FROM recent_projects WHERE deviceId = ? AND projectName = ?')
          .run(request.params.id, oldName)
        return { success: true, data: detail }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string; projectName: string }; Body: { line?: number } }>(
    '/api/devices/:id/projects/:projectName/run',
    async (request, reply): Promise<ApiResponse<{ preCompile: unknown; debugger: unknown }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const project = assertProjectName(request.params.projectName)
        const sftp = getProjectSftp(request.params.id)
        const summary = await summarizeProject(sftp, project)
        const debuggerResult = await startProject(request.params.id, project, summary.language, request.body.line ?? 0)
        return { success: true, data: { preCompile: null, debugger: debuggerResult } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string; projectName: string }; Body: { name: string; content?: string } }>(
    '/api/devices/:id/projects/:projectName/files',
    async (request, reply): Promise<ApiResponse<ControllerProjectDetail>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const sftp = getProjectSftp(request.params.id)
        await sftp.writeText(projectFilePath(request.params.projectName, request.body.name), request.body.content ?? '', 0o777)
        const detail = await readProjectDetail(sftp, request.params.projectName)
        rememberRecentProject(request.auth!.userId, request.params.id, detail)
        return { success: true, data: detail }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.put<{ Params: { id: string; projectName: string; fileName: string }; Body: { content: string } }>(
    '/api/devices/:id/projects/:projectName/files/:fileName',
    async (request, reply): Promise<ApiResponse<ControllerProjectDetail>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const fileName = assertProjectFileName(request.params.fileName)
        if (!isEditableProjectFile(fileName)) return { success: false, error: { code: 40301, message: '该文件由控制器生成，不允许编辑' } }
        const sftp = getProjectSftp(request.params.id)
        await sftp.writeText(projectFilePath(request.params.projectName, fileName), request.body.content ?? '', 0o777)
        const detail = await readProjectDetail(sftp, request.params.projectName)
        rememberRecentProject(request.auth!.userId, request.params.id, detail)
        return { success: true, data: detail }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.delete<{ Params: { id: string; projectName: string; fileName: string } }>(
    '/api/devices/:id/projects/:projectName/files/:fileName',
    async (request, reply): Promise<ApiResponse<ControllerProjectDetail>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const fileName = assertProjectFileName(request.params.fileName)
        if (fileName === 'prj.json') return { success: false, error: { code: 42201, message: '不能删除 prj.json' } }
        if (!isEditableProjectFile(fileName)) return { success: false, error: { code: 40301, message: '该文件由控制器生成，不允许删除' } }
        const sftp = getProjectSftp(request.params.id)
        await sftp.deleteFile(projectFilePath(request.params.projectName, fileName))
        const detail = await readProjectDetail(sftp, request.params.projectName)
        rememberRecentProject(request.auth!.userId, request.params.id, detail)
        return { success: true, data: detail }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 列出当前用户的脚本 */
  app.get('/api/scripts', async (request, reply): Promise<ApiResponse<Script[]>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply

      const db = getDb()
      const scripts = db
        .prepare('SELECT * FROM scripts WHERE userId = ? ORDER BY updatedAt DESC')
        .all(request.auth!.userId) as Script[]

      return { success: true, data: scripts }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 创建脚本 */
  app.post<{ Body: { name: string; content: string; language?: string; deviceId?: string } }>(
    '/api/scripts',
    async (request, reply): Promise<ApiResponse<Script>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const { name, content, language = 'lua', deviceId } = request.body
        if (!name) {
          return { success: false, error: { code: 42200, message: '缺少 name' } }
        }

        const db = getDb()
        const id = uuidv4()
        const now = new Date().toISOString()

        db.prepare(
          'INSERT INTO scripts (id, userId, name, content, language, deviceId, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(id, request.auth!.userId, name, content ?? '', normalizeLanguage(language), deviceId ?? null, now)

        const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as Script
        return { success: true, data: script }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 获取脚本 */
  app.get<{ Params: { id: string } }>(
    '/api/scripts/:id',
    async (request, reply): Promise<ApiResponse<Script>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const db = getDb()
        const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND userId = ?').get(
          request.params.id,
          request.auth!.userId
        ) as Script | undefined

        if (!script) {
          return { success: false, error: { code: 40402, message: '脚本不存在' } }
        }

        return { success: true, data: script }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 更新脚本 */
  app.put<{ Params: { id: string }; Body: { name?: string; content?: string; language?: string; deviceId?: string | null } }>(
    '/api/scripts/:id',
    async (request, reply): Promise<ApiResponse<Script>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const db = getDb()
        const { name, content, language, deviceId } = request.body
        const now = new Date().toISOString()

        if (name) {
          db.prepare('UPDATE scripts SET name = ?, updatedAt = ? WHERE id = ? AND userId = ?')
            .run(name, now, request.params.id, request.auth!.userId)
        }
        if (content !== undefined) {
          db.prepare('UPDATE scripts SET content = ?, updatedAt = ? WHERE id = ? AND userId = ?')
            .run(content, now, request.params.id, request.auth!.userId)
        }
        if (language !== undefined) {
          db.prepare('UPDATE scripts SET language = ?, updatedAt = ? WHERE id = ? AND userId = ?')
            .run(normalizeLanguage(language), now, request.params.id, request.auth!.userId)
        }
        if (deviceId !== undefined) {
          db.prepare('UPDATE scripts SET deviceId = ?, updatedAt = ? WHERE id = ? AND userId = ?')
            .run(deviceId, now, request.params.id, request.auth!.userId)
        }

        const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND userId = ?')
          .get(request.params.id, request.auth!.userId) as Script | undefined

        if (!script) {
          return { success: false, error: { code: 40402, message: '脚本不存在' } }
        }

        return { success: true, data: script }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 删除脚本 */
  app.delete<{ Params: { id: string } }>(
    '/api/scripts/:id',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const db = getDb()
        const result = db.prepare('DELETE FROM scripts WHERE id = ? AND userId = ?').run(
          request.params.id,
          request.auth!.userId
        )

        if (result.changes === 0) {
          return { success: false, error: { code: 40402, message: '脚本不存在' } }
        }

        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 部署脚本为控制器项目 */
  app.post<{ Params: { id: string }; Body: ScriptDeployBody }>(
    '/api/scripts/:id/deploy',
    async (request, reply): Promise<ApiResponse<ScriptDeployResult>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const db = getDb()
        const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND userId = ?')
          .get(request.params.id, request.auth!.userId) as Script | undefined
        if (!script) return { success: false, error: { code: 40402, message: '脚本不存在' } }
        if (!request.body.deviceId) return { success: false, error: { code: 42200, message: '缺少 deviceId' } }

        const deployed = await deployScriptProject(script, request.body.deviceId, request.body.projectName)
        return { success: true, data: deployed }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 部署并启动脚本项目 */
  app.post<{ Params: { id: string }; Body: ScriptRunBody }>(
    '/api/scripts/:id/run',
    async (request, reply): Promise<ApiResponse<ScriptRunResult>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const db = getDb()
        const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND userId = ?')
          .get(request.params.id, request.auth!.userId) as Script | undefined
        if (!script) return { success: false, error: { code: 40402, message: '脚本不存在' } }
        if (!request.body.deviceId) return { success: false, error: { code: 42200, message: '缺少 deviceId' } }

        const deployed = await deployScriptProject(script, request.body.deviceId, request.body.projectName)
        const debuggerResult = await startProject(request.body.deviceId, deployed.projectName, script.language, request.body.line ?? 0)
        return { success: true, data: { deployed, preCompile: null, debugger: debuggerResult } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: { project: string } }>(
    '/api/devices/:id/debugger/preCompile',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (!request.body.project) return { success: false, error: { code: 42200, message: '缺少 project' } }
        const data = await preCompileProject(request.params.id, request.body.project)
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/debugger/state',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const data = await sendDebugger(request.params.id, '/debugger/state', undefined, 'get')
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/debugger/breakPoint',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const data = await sendDebugger(request.params.id, '/debugger/breakPoint', undefined, 'get')
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: DebuggerBreakPointBody }>(
    '/api/devices/:id/debugger/breakPoint',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const opCode = request.body.opCode ?? 4
        const line = request.body.line ?? []
        if (!Array.isArray(line) || !line.every(group => Array.isArray(group) && group.every(item => Number.isInteger(item) && item > 0))) {
          return { success: false, error: { code: 42200, message: '断点行号不合法' } }
        }
        const data = await sendDebugger(request.params.id, '/debugger/breakPoint', { opCode, line })
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: { type?: number; line?: number } }>(
    '/api/devices/:id/debugger/run',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const data = await sendDebugger(request.params.id, '/debugger/run', {
          type: request.body.type ?? 0,
          line: request.body.line,
        })
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/debugger/suspend',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const data = await sendDebugger(request.params.id, '/debugger/suspend')
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/debugger/stop',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const data = await sendDebugger(request.params.id, '/debugger/stop')
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )
}
