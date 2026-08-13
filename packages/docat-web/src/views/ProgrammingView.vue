<template>
  <div class="programming-page" tabindex="0" @keydown="onKeyDown">
    <header class="workspace-header">
      <div class="workspace-header-left">
        <router-link :to="{ path: '/', query: $route.query }" class="back-btn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          仪表板
        </router-link>
        <div>
          <h2>脚本编程</h2>
          <p class="header-subtitle">
            {{ routeDevice ? `${routeDevice.name} · ${routeDevice.ip}` : '控制器项目 · SFTP 工作区' }}
          </p>
        </div>
      </div>
      <div class="workspace-header-center">
        <div class="workspace-switch">
          <router-link :to="{ path: routeDeviceId ? `/device/${routeDeviceId}` : '/', query: $route.query }" class="workspace-switch-btn">
            {{ routeDeviceId ? '控制' : '仪表板' }}
          </router-link>
          <router-link :to="{ path: routeDeviceId ? `/device/${routeDeviceId}/programming` : '/programming', query: $route.query }" class="workspace-switch-btn workspace-switch-btn--active">
            编程
          </router-link>
          <router-link v-if="routeDeviceId" :to="{ path: `/device/${routeDeviceId}/tcp`, query: $route.query }" class="workspace-switch-btn">
            TCP
          </router-link>
        </div>
      </div>
      <div class="workspace-header-actions">
        <button class="btn btn-secondary" @click="loadAll" :disabled="loading">
          {{ loading ? '加载中...' : '刷新' }}
        </button>
      </div>
    </header>

    <div class="programming-grid mt-2">
      <aside class="project-list-panel card">
        <label class="field-label">设备</label>
        <select v-model="selectedDeviceId" class="select-input" :disabled="Boolean(routeDeviceId)">
          <option value="">选择设备</option>
          <option v-for="device in devices" :key="device.id" :value="device.id">
            {{ device.name }} · {{ device.ip }}
          </option>
        </select>

        <div class="create-row mt-1">
          <input v-model.trim="newProjectName" class="input" placeholder="项目名称" />
          <select v-model="newProjectLanguage" class="select-input select-input--compact">
            <option value="lua">Lua</option>
            <option value="python">Python</option>
            <option value="blockly">Blockly</option>
          </select>
          <button class="btn btn-primary btn-sm" :disabled="!selectedDeviceId || !newProjectName || creating" @click="createProject">
            {{ creating ? '新建中...' : '新建' }}
          </button>
        </div>

        <div v-if="recentProjects.length" class="project-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">最近</span>
            <span class="script-count">{{ recentProjects.length }}</span>
          </div>
          <button
            v-for="project in recentProjects"
            :key="project.projectName"
            :class="['script-row', { 'script-row--active': activeProject?.name === project.projectName }]"
            @click="openProject(project.projectName)"
          >
            <span class="script-row-name">{{ project.projectName }}</span>
            <span class="script-row-meta">{{ project.language.toUpperCase() }} · {{ formatTime(project.openedAt) }}</span>
          </button>
        </div>

        <div class="project-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">项目</span>
            <span class="panel-title-right">
              <span v-if="loadingProjects && projects.length" class="loading-ring loading-ring--small"></span>
              <span class="script-count">{{ projects.length }}</span>
            </span>
          </div>
          <div class="script-list list-loading-anchor">
            <div
              v-for="project in projects"
              :key="project.name"
              :class="['project-row', { 'project-row--active': activeProject?.name === project.name, 'project-row--loading': openingProjectName === project.name }]"
            >
              <button class="project-row-main" @click="openProject(project.name)" :disabled="opening">
                <span class="script-row-name">{{ project.name }}</span>
                <span class="script-row-meta">
                  <template v-if="refreshing && activeProject?.name === project.name">
                    <span class="loading-ring loading-ring--small"></span> 同步中...
                  </template>
                  <template v-else-if="openingProjectName === project.name">打开中...</template>
                  <template v-else>{{ project.language.toUpperCase() }} · {{ project.files }} 个文件</template>
                </span>
              </button>
              <div class="project-row-actions">
                <button class="mini-action" @click="renameProjectFromList(project.name)" :disabled="opening || renaming">重命名</button>
                <button class="mini-action mini-action--danger" @click="deleteProjectByName(project.name)" :disabled="opening || deletingProject">删除</button>
              </div>
            </div>
            <div v-if="!projects.length" class="empty-list">暂无控制器项目</div>
            <div v-if="loadingProjects && !projects.length" class="panel-loading">
              <span class="loading-ring"></span>
              <strong>正在加载项目</strong>
            </div>
          </div>
        </div>
      </aside>

      <main class="editor-panel card">
        <div v-if="activeProject" class="editor-toolbar">
          <div class="editor-title">
            <strong>{{ activeProject.name }}</strong>
            <span>{{ activeProject.language.toUpperCase() }} · {{ activeProject.path }}</span>
          </div>
          <div class="toolbar-actions">
            <div class="mode-toggle">
              <button :class="['mode-btn', { 'mode-btn--active': openMode === 'source' }]" @click="openMode = 'source'">源码</button>
              <button :class="['mode-btn', { 'mode-btn--active': openMode === 'all' }]" @click="openMode = 'all'">全部</button>
            </div>
            <span v-if="refreshing" class="refresh-indicator">
              <span class="loading-ring loading-ring--small"></span>
              同步中…
            </span>
            <button class="btn btn-primary btn-sm" @click="saveActiveFile" :disabled="!activeFile || !activeFile.editable || saving || refreshing">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>

        <div v-if="activeProject" class="file-tabs">
          <button
            v-for="file in visibleFiles"
            :key="file.name"
            :class="['file-tab', { 'file-tab--active': activeFileName === file.name, 'file-tab--dirty': isDirty(file.name) }]"
            @click="selectFile(file.name)"
          >
            {{ file.name }}
          </button>
        </div>

        <div v-if="activeProject && activeFile" ref="editorContainer" class="code-editor" />

        <div v-else-if="!activeProject" class="editor-empty">
          <h3>未打开项目</h3>
          <p>选择一个控制器项目以编辑其文件。</p>
        </div>

        <div v-if="opening" class="editor-loading">
          <span class="loading-ring loading-ring--large"></span>
          <strong>{{ openingProjectName ? `正在打开 ${openingProjectName}` : '正在打开项目' }}</strong>
        </div>

        <!-- Points panel below editor -->
        <div v-if="activeProject" class="points-bar">
          <div class="points-bar-header">
            <span class="hud-label" style="margin-bottom:0">点位</span>
            <button class="btn btn-primary btn-sm" :disabled="!selectedDeviceId || savingPoint" @click="doSavePoint">
              {{ savingPoint ? '保存中...' : '保存点位' }}
            </button>
          </div>
          <div v-if="projectPoints.length" class="points-bar-list">
            <span v-for="point in projectPoints" :key="point.id"
              class="points-bar-chip" :class="{ 'points-bar-chip--editing': editingPointId === point.id }"
              @click="editingPointId = point.id">
              <template v-if="editingPointId !== point.id">
                <strong>{{ point.name }}</strong>
                <small>{{ point.joint.map(v => v.toFixed(1)).slice(0, 3).join(', ') }}...</small>
                <button class="points-bar-del" @click.stop="doDeletePoint(point)" :disabled="deletingPoint">×</button>
              </template>
              <template v-else>
                <span class="points-edit-row" @click.stop>
                  <input v-for="(v, j) in editingJoints" :key="j" v-model.number="editingJoints[j]"
                    type="number" step="0.1" class="points-edit-input" />
                  <button class="btn btn-primary btn-sm" @click="doUpdatePoint(point)" :disabled="updatingPoint">✓</button>
                  <button class="btn btn-secondary btn-sm" @click="editingPointId = ''">✕</button>
                </span>
              </template>
            </span>
          </div>
          <div v-else class="points-bar-empty">暂无点位 — 示教并保存</div>
        </div>

      </main>

      <aside class="run-panel card">
        <div v-if="activeProject" class="side-section">
          <span class="hud-label">控制</span>
          <div class="run-actions">
          <span class="btn-wrap" title="运行脚本 (F9)">
            <button class="btn btn-success" :disabled="starting || running || !selectedDeviceId" @click="runProject">
              {{ starting ? '启动中...' : running ? '运行中' : '运行' }}
            </button>
          </span>
          <span class="btn-wrap" title="停止运行 (F6)">
            <button class="btn btn-danger" :disabled="stopping || !selectedDeviceId" @click="stopDebugger">
              {{ stopping ? '停止中...' : '停止' }}
            </button>
          </span>
            <button class="btn btn-secondary" :disabled="pausing || !selectedDeviceId" @click="pauseDebugger">
              {{ pausing ? '暂停中...' : '暂停' }}
            </button>
            <button class="btn btn-secondary" :disabled="continuing || !selectedDeviceId" @click="continueDebugger">
              {{ continuing ? '继续中...' : '继续' }}
            </button>
          </div>
        </div>

        <div v-if="activeProject" class="runtime-panel side-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">运行日志</span>
            <button class="btn btn-secondary btn-sm" @click="clearRuntimeLogs">清空</button>
          </div>
          <div class="runtime-cursor">
            <span>光标</span>
            <strong>{{ runtimeCursorText || '--' }}</strong>
          </div>
          <div ref="runtimeLogContainer" class="runtime-log-list">
            <div v-for="entry in runtimeLogs" :key="entry.id" :class="['runtime-log-row', `runtime-log-row--${entry.level}`]">
              <span>{{ formatTime(entry.time) }}</span>
              <strong>{{ entry.level }}</strong>
              <p>{{ entry.text }}</p>
            </div>
            <div v-if="!runtimeLogs.length" class="runtime-empty">暂无运行日志</div>
          </div>
        </div>

        <div v-if="activeProject" class="file-list side-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">文件</span>
          </div>
          <button
            v-for="file in activeProject.fileList"
            :key="file.name"
            :class="['file-row', { 'file-row--active': activeFileName === file.name }]"
            @click="selectFile(file.name)"
          >
            <span>{{ file.name }}</span>
            <small>{{ file.rights?.user || '--' }}/{{ file.rights?.group || '--' }}/{{ file.rights?.other || '--' }} · {{ formatBytes(file.size) }}</small>
            <button
              v-if="file.name !== 'prj.json' && file.editable"
              class="file-delete"
              @click.stop="deleteFile(file.name)"
            >
              删除
            </button>
          </button>
        </div>

        <div v-if="activeProject" class="project-tools side-section">
          <span class="hud-label">文件工具</span>
          <label class="field-label">重命名项目</label>
          <div class="inline-row">
            <input v-model.trim="renameName" class="input" />
            <button class="btn btn-secondary btn-sm" :disabled="!renameName || renaming" @click="renameProject">
              重命名
            </button>
          </div>

          <label class="field-label mt-1">添加文件</label>
          <div class="inline-row">
            <input v-model.trim="newFileName" class="input" placeholder="file.lua" />
            <button class="btn btn-secondary btn-sm" :disabled="!newFileName || addingFile" @click="addFile">
              添加
            </button>
          </div>
        </div>

        <div v-if="activeProject" class="side-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">项目</span>
            <button class="btn btn-danger btn-sm" :disabled="deletingProject" @click="deleteProject">删除</button>
          </div>
          <div class="deploy-info">
            <div class="info-row">
              <span>名称</span>
              <strong>{{ activeProject.name }}</strong>
            </div>
            <div class="info-row">
              <span>修改时间</span>
              <strong>{{ formatTime(activeProject.modifiedAt) }}</strong>
            </div>
            <div class="info-row">
              <span>文件</span>
              <strong>{{ activeProject.files }}</strong>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <div v-if="dialog.kind" class="modal-backdrop" @click.self="closeDialog">
      <div class="modal-panel">
        <div class="panel-title-row">
          <span class="hud-label" style="margin-bottom:0">{{ dialogTitle }}</span>
          <button class="mini-action" @click="closeDialog">关闭</button>
        </div>
        <p class="modal-message">{{ dialog.message }}</p>
        <input
          v-if="dialog.kind === 'rename-project'"
          v-model.trim="dialog.input"
          class="input"
          @keyup.enter="confirmDialog"
        />
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" @click="closeDialog">取消</button>
          <button
            :class="['btn', dialogDanger ? 'btn-danger' : 'btn-primary', 'btn-sm']"
            :disabled="dialog.kind === 'rename-project' && !dialog.input"
            @click="confirmDialog"
          >
            确认
          </button>
        </div>
      </div>
    </div>

    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/features/register.all'
import 'monaco-editor/languages/definitions/lua/register'
import 'monaco-editor/languages/definitions/python/register'
import 'monaco-editor/languages/features/json/register'
import * as api from '../services/api'
import { wsClient } from '../services/ws'
import { DOBOT_API_CATALOG } from '../services/dobotApiCatalog'
import { deviceStore } from '../stores/deviceStore'
import { runtimeStore } from '../stores/runtimeStore'
import type { RuntimeLogEntry } from '../stores/runtimeStore'
import { loadWorkspace, saveWorkspace } from '../stores/workspaceState'
import Toast from '../components/Toast.vue'
import type { DeviceConfig, ScriptLanguage } from 'docat-shared/types'

type MonacoLanguage = 'lua' | 'python'
type OpenMode = 'source' | 'all'
type DialogKind = '' | 'rename-project' | 'delete-project' | 'delete-file'

defineOptions({ name: 'ProgrammingView' })

const workerScope = self as unknown as {
  MonacoEnvironment?: monaco.Environment
  __docatMonacoCompletionDisposables?: Array<{ dispose: () => void }>
}
workerScope.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

const route = useRoute()
const isMock = route.query.mock === '1'
const MOCK_PROJECTS = {
  'robot_test': { language: 'lua' as ScriptLanguage, files: 2, modifiedAt: '2026-06-13T10:00:00Z' },
  'demo_app': { language: 'lua' as ScriptLanguage, files: 1, modifiedAt: '2026-06-12T08:30:00Z' },
  'vision_pick': { language: 'python' as ScriptLanguage, files: 3, modifiedAt: '2026-06-11T14:20:00Z' },
  'calibrate': { language: 'python' as ScriptLanguage, files: 1, modifiedAt: '2026-06-10T09:00:00Z' },
}

/** Generate mock project detail when user 'opens' a mock project */
function makeMockDetail(name: string, language: ScriptLanguage): api.ControllerProjectDetail {
  const ext = language === 'python' ? '.py' : '.lua'
  const sampleContent = language === 'python'
    ? `# Mock ${name}\nimport Dobot\n\ndef main():\n    Dobot.MoveJoints(0, 0, 0, 0, 0, 0)\n    print("Running ${name}")\n\nif __name__ == "__main__":\n    main()\n`
    : `-- Mock ${name}\nlocal Dobot = ...\n\nfunction main()\n    Dobot.MoveJoints(0, 0, 0, 0, 0, 0)\n    print("Running ${name}")\nend\n\nmain()\n`
  return {
    name, path: `/${name}${ext}`, language, size: sampleContent.length,
    modifiedAt: '', files: 1, prj: {},
    fileList: [{ name: `main${ext}`, path: `/${name}/main${ext}`, size: sampleContent.length, modifyTime: Date.now(), content: sampleContent, editable: true, language: language as 'lua' | 'python' | 'json' | 'xml' | 'text', rights: {} }],
  }
}

if (isMock) {
  console.log('[Mock] Programming debug mode active')
  deviceStore.setDevices([{ id: 'mock-dev', ip: '0.0.0.0', name: 'MOCK DEVICE', type: 'MG6', autoConnect: false, createdAt: '' }])
}
const toastRef = ref<InstanceType<typeof Toast>>()
const devices = ref<DeviceConfig[]>(Object.values(deviceStore.devices))
const projects = ref<api.ControllerProjectSummary[]>([])
const recentProjects = ref<api.RecentProject[]>([])
const activeProject = ref<api.ControllerProjectDetail | null>(null)
const activeFileName = ref('')
const selectedDeviceId = ref('')
const newProjectName = ref('')
const newProjectLanguage = ref<ScriptLanguage>('lua')
const newFileName = ref('')
const renameName = ref('')
const openMode = ref<OpenMode>('source')
const editorContainer = ref<HTMLElement | null>(null)
const runtimeLogContainer = ref<HTMLElement | null>(null)
const runtimeState = computed(() => selectedDeviceId.value ? runtimeStore.getState(selectedDeviceId.value) : null)
const runtimeLogs = computed<RuntimeLogEntry[]>(() => runtimeState.value?.logs ?? [])
const runtimeCursorText = computed(() => runtimeState.value?.cursorText ?? '')
const running = computed(() => runtimeState.value?.running ?? false)
const loading = ref(false)
const loadingProjects = ref(false)
const opening = ref(false)
const openingProjectName = ref('')
/** 缓存命中后的后台同步状态：同步期间 Monaco 只读，禁止编辑/保存 */
const refreshing = ref(false)
const creating = ref(false)
const saving = ref(false)
const savingPoint = ref(false)
const deletingPoint = ref(false)
const updatingPoint = ref(false)
const editingPointId = ref('')
const editingJoints = ref<number[]>([0,0,0,0,0,0])
const projectPoints = ref<api.PointData[]>([])
const starting = ref(false)
const stopping = ref(false)
const pausing = ref(false)
const continuing = ref(false)
const renaming = ref(false)
const addingFile = ref(false)
const deletingProject = ref(false)
const dirtyFiles = ref<string[]>([])
const dialog = ref({
  kind: '' as DialogKind,
  projectName: '',
  fileName: '',
  input: '',
  message: '',
})

const routeDeviceId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const routeDevice = computed(() => deviceStore.getDevice(routeDeviceId.value) ?? devices.value.find(device => device.id === routeDeviceId.value))
const visibleFiles = computed(() => {
  const files = activeProject.value?.fileList ?? []
  if (openMode.value === 'all') return files
  return files.filter(file => file.name.endsWith('.lua') || file.name.endsWith('.py'))
})
const activeFile = computed(() => activeProject.value?.fileList.find(file => file.name === activeFileName.value) ?? null)
const dialogTitle = computed(() => {
  if (dialog.value.kind === 'rename-project') return '重命名项目'
  if (dialog.value.kind === 'delete-project') return '删除项目'
  if (dialog.value.kind === 'delete-file') return '删除文件'
  return ''
})
const dialogDanger = computed(() => dialog.value.kind === 'delete-project' || dialog.value.kind === 'delete-file')

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let cursorDecorations: monaco.editor.IEditorDecorationsCollection | null = null
let breakpointDecorations: monaco.editor.IEditorDecorationsCollection | null = null
let resizeObserver: ResizeObserver | null = null
let syncingEditor = false
let monacoConfiguredForInstance = false
let completionDisposables: Array<{ dispose: () => void }> = []
let savedEditorViewState: monaco.editor.ICodeEditorViewState | null = null
let pendingViewState: unknown = null
let workspaceSaveTimer: ReturnType<typeof setTimeout> | null = null
let editorCursorSub: { dispose(): void } | null = null
let runtimePollTimer: ReturnType<typeof setInterval> | null = null
const autoOpenedForDevice = ref('')
let editorScrollSub: { dispose(): void } | null = null
const breakpoints = ref<Record<string, number[]>>({})

const LANGUAGE_KEYWORDS: Record<MonacoLanguage, string[]> = {
  lua: ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'],
  python: ['and', 'as', 'break', 'class', 'continue', 'def', 'elif', 'else', 'False', 'for', 'from', 'if', 'import', 'in', 'is', 'lambda', 'None', 'not', 'or', 'pass', 'return', 'True', 'while', 'with'],
}
const IDENTIFIER_PATTERN = '[A-Za-z_][A-Za-z0-9_]*'
const IDENTIFIER_TRIGGER_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split('')

function stripComments(text: string, language: MonacoLanguage): string {
  if (language === 'lua') {
    return text
      .replace(/--\[\[[\s\S]*?\]\]/g, ' ')
      .replace(/--.*$/gm, ' ')
  }
  return text
    .replace(/'''[\s\S]*?'''/g, ' ')
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/#.*$/gm, ' ')
}

function collectProjectPointNames(language: MonacoLanguage): string[] {
  if (!activeProject.value) return []
  const pointFile = activeProject.value.fileList.find(file => file.name === 'point.json')
  if (!pointFile?.content) return []
  try {
    const points = JSON.parse(pointFile.content) as Array<Record<string, unknown>>
    return points
      .map(point => String(point.name ?? point.alias ?? point.id ?? '').trim())
      .filter(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !LANGUAGE_KEYWORDS[language].includes(name))
  } catch {
    return []
  }
}

function collectLocalSymbols(model: monaco.editor.ITextModel, language: MonacoLanguage): Array<{ label: string; kind: monaco.languages.CompletionItemKind; detail: string }> {
  const text = stripComments(model.getValue(), language)
  const seen = new Set<string>()
  const symbols: Array<{ label: string; kind: monaco.languages.CompletionItemKind; detail: string }> = []
  const add = (label: string, kind: monaco.languages.CompletionItemKind, detail: string) => {
    if (!label || seen.has(label) || LANGUAGE_KEYWORDS[language].includes(label)) return
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) return
    seen.add(label)
    symbols.push({ label, kind, detail })
  }

  if (language === 'python') {
    const identifierListPattern = new RegExp(`^\\s*(${IDENTIFIER_PATTERN}(?:\\s*,\\s*${IDENTIFIER_PATTERN})+)\\s*(?::[^=\\n]+)?=`, 'gm')
    for (const match of text.matchAll(identifierListPattern)) {
      for (const name of match[1].split(',')) add(name.trim(), monaco.languages.CompletionItemKind.Variable, 'local variable')
    }
    const assignmentPattern = new RegExp(`^\\s*(${IDENTIFIER_PATTERN})\\s*(?::[^=\\n]+)?=`, 'gm')
    for (const match of text.matchAll(assignmentPattern)) add(match[1], monaco.languages.CompletionItemKind.Variable, 'local variable')
    for (const match of text.matchAll(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/gm)) {
      add(match[1], monaco.languages.CompletionItemKind.Function, 'local function')
      for (const param of match[2].split(',')) add(param.trim().replace(/=.*$/, '').replace(/:.*/, ''), monaco.languages.CompletionItemKind.Variable, 'function parameter')
    }
    for (const match of text.matchAll(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)) add(match[1], monaco.languages.CompletionItemKind.Class, 'local class')
    for (const match of text.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s+in\b/g)) {
      for (const name of match[1].split(',')) add(name.trim(), monaco.languages.CompletionItemKind.Variable, 'loop variable')
    }
    for (const match of text.matchAll(/\bwith\s+.+?\s+as\s+([A-Za-z_][A-Za-z0-9_]*)/g)) add(match[1], monaco.languages.CompletionItemKind.Variable, 'context variable')
  } else {
    for (const match of text.matchAll(/\blocal\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g)) {
      add(match[1], monaco.languages.CompletionItemKind.Function, 'local function')
      for (const param of match[2].split(',')) add(param.trim(), monaco.languages.CompletionItemKind.Variable, 'function parameter')
    }
    for (const match of text.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_:.]*)\s*\(([^)]*)\)/g)) {
      const label = match[1].split(/[.:]/).pop() ?? match[1]
      add(label, monaco.languages.CompletionItemKind.Function, 'local function')
      for (const param of match[2].split(',')) add(param.trim(), monaco.languages.CompletionItemKind.Variable, 'function parameter')
    }
    for (const match of text.matchAll(/\blocal\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*(?:=|$)/gm)) {
      for (const name of match[1].split(',')) add(name.trim(), monaco.languages.CompletionItemKind.Variable, 'local variable')
    }
    for (const match of text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) add(match[1], monaco.languages.CompletionItemKind.Variable, 'global variable')
    for (const match of text.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*(?:=|in)\b/g)) {
      for (const name of match[1].split(',')) add(name.trim(), monaco.languages.CompletionItemKind.Variable, 'loop variable')
    }
  }

  for (const pointName of collectProjectPointNames(language)) add(pointName, monaco.languages.CompletionItemKind.Value, 'project point')
  return symbols
}

function formatTime(value: string): string {
  if (!value) return '--'
  return new Date(value).toLocaleString()
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} KB`
}

function dirtyKey(fileName: string): string {
  return `${selectedDeviceId.value}/${activeProject.value?.name || ''}/${fileName}`
}

function isDirty(fileName: string): boolean {
  return dirtyFiles.value.includes(dirtyKey(fileName))
}

function setDirty(fileName: string, value: boolean) {
  const key = dirtyKey(fileName)
  if (value && !dirtyFiles.value.includes(key)) dirtyFiles.value = [...dirtyFiles.value, key]
  if (!value) dirtyFiles.value = dirtyFiles.value.filter(item => item !== key)
}

/** 每个文件的"已保存"内容基线（key 与 dirtyFiles 相同），用于撤销回保存态时自动清除脏标记 */
const fileBaselines: Record<string, string> = {}

function getBaseline(fileName: string): string | undefined {
  return fileBaselines[dirtyKey(fileName)]
}

/** 用项目详情刷新全部文件的保存基线（打开/保存/增删文件后调用） */
function setFileBaselines(detail: api.ControllerProjectDetail) {
  for (const file of detail.fileList) {
    fileBaselines[dirtyKey(file.name)] = file.content
  }
}

/** 打开/切换文件时补齐基线（首次进入该文件） */
function ensureFileBaseline(fileName: string) {
  const key = dirtyKey(fileName)
  if (fileBaselines[key] !== undefined) return
  const file = activeProject.value?.fileList.find(f => f.name === fileName)
  if (file) fileBaselines[key] = file.content
}

function breakpointKey(projectName: string, fileName: string): string {
  return `${selectedDeviceId.value}/${projectName}/${fileName}`
}

function activeBreakpointKey(fileName = activeFileName.value): string {
  return activeProject.value ? breakpointKey(activeProject.value.name, fileName) : ''
}

function getFileBreakpoints(fileName: string): number[] {
  const key = activeBreakpointKey(fileName)
  return key ? breakpoints.value[key] ?? [] : []
}

function setFileBreakpoints(fileName: string, lines: number[]) {
  const key = activeBreakpointKey(fileName)
  if (!key) return
  breakpoints.value = {
    ...breakpoints.value,
    [key]: [...new Set(lines.filter(line => Number.isInteger(line) && line > 0))].sort((a, b) => a - b),
  }
}

function getProjectRecord(): Record<string, unknown> {
  return activeProject.value?.prj && typeof activeProject.value.prj === 'object'
    ? activeProject.value.prj as Record<string, unknown>
    : {}
}

function getDebuggerSourceFiles(): string[] {
  if (!activeProject.value) return []
  const files = activeProject.value.fileList
  const fileNames = new Set(files.filter(file => file.editable).map(file => file.name))
  const prj = getProjectRecord()
  const ordered: string[] = []
  const add = (name: unknown) => {
    if (typeof name === 'string' && fileNames.has(name) && !ordered.includes(name)) ordered.push(name)
  }

  if (activeProject.value.language === 'python') {
    add(prj.main)
    add(typeof prj.var === 'string' ? prj.var : 'var.py')
    if (Array.isArray(prj.submain)) prj.submain.forEach(add)
    files
      .filter(file => file.editable && file.name.endsWith('.py') && file.name !== 'point.json.py')
      .forEach(file => add(file.name))
  } else {
    const cpus = Array.isArray(prj.cpus) ? prj.cpus.filter(item => typeof item === 'string') as string[] : []
    if (cpus.length) {
      add(cpus[0])
      add(typeof prj.global === 'string' ? prj.global : 'global.lua')
      cpus.slice(1).forEach(add)
    }
    files
      .filter(file => file.editable && file.name.endsWith('.lua') && !['point.json.lua', 'globalsDeclaration.lua'].includes(file.name))
      .forEach(file => add(file.name))
  }

  return ordered
}

function buildDebuggerBreakpoints(): number[][] {
  return getDebuggerSourceFiles().map(fileName => getFileBreakpoints(fileName))
}

function fileToMonacoLanguage(file: api.ControllerProjectFile | null): string {
  if (!file) return 'plaintext'
  if (file.name.endsWith('.lua')) return 'lua'
  if (file.name.endsWith('.py')) return 'python'
  if (file.name.endsWith('.json')) return 'json'
  if (file.name.endsWith('.xml')) return 'xml'
  if (file.editable && activeProject.value?.language === 'lua') return 'lua'
  if (file.editable && activeProject.value?.language === 'python') return 'python'
  return 'plaintext'
}

function configureMonaco() {
  monaco.editor.defineTheme('docat-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '7dd3fc', fontStyle: 'bold' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#0c0d0f',
      'editor.foreground': '#d8e7ff',
      'editorLineNumber.foreground': '#496384',
      'editorLineNumber.activeForeground': '#22d3ee',
      'editorCursor.foreground': '#22d3ee',
      'editor.selectionBackground': '#164e63',
      'editor.lineHighlightBackground': '#0b1628',
      'editorGutter.background': '#0c0d0f',
    },
  })
  if (monacoConfiguredForInstance) return
  monacoConfiguredForInstance = true

  workerScope.__docatMonacoCompletionDisposables?.forEach(disposable => disposable.dispose())
  completionDisposables = []

  for (const language of ['lua', 'python'] as MonacoLanguage[]) {
    completionDisposables.push(monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', ':', '(', ',', ...IDENTIFIER_TRIGGER_CHARACTERS],
      provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
        const word = model.getWordUntilPosition(position)
        const currentWord = word.word.toLowerCase()
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        const usedLabels = new Set<string>()
        const symbolSuggestions = collectLocalSymbols(model, language)
          .filter(item => !usedLabels.has(item.label))
          .map((item, index) => {
            usedLabels.add(item.label)
            return {
              label: item.label,
              kind: item.kind,
              detail: item.detail,
              insertText: item.label,
              sortText: `0000${index.toString().padStart(3, '0')}_${item.label}`,
              range,
            }
          })
        const apiSuggestions = DOBOT_API_CATALOG[language].filter(item => !usedLabels.has(item.label)).map((item, index) => {
          usedLabels.add(item.label)
          return {
            label: item.label,
            kind: monaco.languages.CompletionItemKind.Function,
            detail: item.detail,
            documentation: item.documentation,
            filterText: `${item.label} ${item.label.toLowerCase()} ${item.category} ${item.aliases}`,
            insertText: item.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: `0500${index.toString().padStart(3, '0')}_${item.label}`,
            preselect: index === 0 && !symbolSuggestions.some(symbol => symbol.label.toLowerCase().startsWith(currentWord)),
            range,
          }
        })
        const keywordSuggestions = LANGUAGE_KEYWORDS[language].filter(keyword => !usedLabels.has(keyword)).map((keyword, index) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          sortText: `1000${index.toString().padStart(3, '0')}_${keyword}`,
          range,
        }))
        return { suggestions: [...symbolSuggestions, ...apiSuggestions, ...keywordSuggestions] }
      },
    }))
  }
  workerScope.__docatMonacoCompletionDisposables = completionDisposables
}

function initEditor() {
  configureMonaco()
  if (!editorContainer.value || editor) return
  editor = monaco.editor.create(editorContainer.value, {
    value: activeFile.value?.content ?? '',
    language: fileToMonacoLanguage(activeFile.value),
    theme: 'docat-dark',
    automaticLayout: false,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 13,
    lineHeight: 21,
    minimap: { enabled: false },
    glyphMargin: true,
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'on',
    contextmenu: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    quickSuggestionsDelay: 60,
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions: 'off',
    suggestSelection: 'first',
    readOnly: refreshing.value || !activeFile.value?.editable,
    suggest: {
      showFunctions: true,
      showKeywords: true,
      showWords: false,
      snippetsPreventQuickSuggestions: false,
    },
    roundedSelection: false,
    padding: { top: 12, bottom: 12 },
  })
  cursorDecorations = editor.createDecorationsCollection()
  breakpointDecorations = editor.createDecorationsCollection()
  editorCursorSub = editor.onDidChangeCursorPosition(scheduleWorkspaceSave)
  editorScrollSub = editor.onDidScrollChange(scheduleWorkspaceSave)
  editor.onDidChangeModelContent(() => {
    if (!editor || syncingEditor || !activeFile.value) return
    activeFile.value.content = editor.getValue()
    // 撤销回保存态时自动清除脏标记（内容与基线一致）
    setDirty(activeFile.value.name, editor.getValue() !== getBaseline(activeFile.value.name))
    clearEditorMarkers()
    updateBreakpointDecorations()
  })
  editor.onMouseDown(event => {
    if (!event.target.position || !activeFile.value?.editable) return
    const targetType = event.target.type
    if (
      targetType === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
      targetType === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
    ) {
      toggleBreakpoint(event.target.position.lineNumber)
    }
  })
  resizeObserver = new ResizeObserver(() => editor?.layout())
  resizeObserver.observe(editorContainer.value)
}

function syncEditor() {
  nextTick(() => {
    initEditor()
    if (!editor) return
    const file = activeFile.value
    ensureFileBaseline(file?.name ?? '')
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, fileToMonacoLanguage(file))
    editor.updateOptions({ readOnly: refreshing.value || !file?.editable })
    if (editor.getValue() !== (file?.content ?? '')) {
      syncingEditor = true
      editor.setValue(file?.content ?? '')
      syncingEditor = false
    }
    updateBreakpointDecorations()
    // 重新应用当前运行行（如脚本已在运行中打开项目）
    const runtime = selectedDeviceId.value ? runtimeStore.getState(selectedDeviceId.value) : null
    if (runtime?.line && runtime.line > 0) setExecutionLine(runtime.line)
    editor.layout()
    // 刷新恢复：应用保存的光标/滚动位置
    if (pendingViewState) {
      try {
        editor.restoreViewState(pendingViewState as monaco.editor.ICodeEditorViewState)
      } catch {
        // 状态已失效则忽略
      }
      pendingViewState = null
    }
  })
}

function clearEditorMarkers() {
  const model = editor?.getModel()
  if (model) monaco.editor.setModelMarkers(model, 'docat-precompile', [])
}

function markEditorError(message: string) {
  const model = editor?.getModel()
  if (!model) return
  const lines = parseErrorLines(message)
  if (!lines.length) return
  monaco.editor.setModelMarkers(model, 'docat-precompile', lines.map(line => ({
    severity: monaco.MarkerSeverity.Error,
    message,
    startLineNumber: Math.min(Math.max(line, 1), model.getLineCount()),
    startColumn: 1,
    endLineNumber: Math.min(Math.max(line, 1), model.getLineCount()),
    endColumn: model.getLineMaxColumn(Math.min(Math.max(line, 1), model.getLineCount())),
  })))
  editor?.revealLineInCenter(lines[0])
}

function setExecutionLine(line: number) {
  const model = editor?.getModel()
  if (!model || !cursorDecorations) return
  const safeLine = Math.min(Math.max(line, 1), model.getLineCount())
  if (selectedDeviceId.value) runtimeStore.getState(selectedDeviceId.value).line = safeLine
  cursorDecorations.set([{
    range: new monaco.Range(safeLine, 1, safeLine, model.getLineMaxColumn(safeLine)),
    options: {
      isWholeLine: true,
      className: 'execution-line',
      glyphMarginClassName: 'execution-line-glyph',
      overviewRuler: {
        color: '#fbbf24',
        position: monaco.editor.OverviewRulerLane.Full,
      },
    },
  }])
  editor?.revealLineInCenterIfOutsideViewport(safeLine)
}

function clearExecutionLine() {
  if (selectedDeviceId.value) runtimeStore.clearLine(selectedDeviceId.value)
  cursorDecorations?.clear()
}

function clearRuntimeLogs() {
  if (selectedDeviceId.value) runtimeStore.getState(selectedDeviceId.value).logs = []
}

// ─── 工作区持久化（刷新后恢复项目/光标；运行状态直接查设备）──

function persistWorkspace(viewState: unknown = null) {
  if (!selectedDeviceId.value || !activeProject.value || !activeFileName.value) return
  saveWorkspace({
    deviceId: selectedDeviceId.value,
    projectName: activeProject.value.name,
    fileName: activeFileName.value,
    viewState,
  })
}

function scheduleWorkspaceSave() {
  if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer)
  workspaceSaveTimer = setTimeout(() => {
    workspaceSaveTimer = null
    persistWorkspace(editor?.saveViewState() ?? null)
  }, 500)
}

async function restoreLastWorkspace() {
  if (!selectedDeviceId.value) return
  const last = loadWorkspace(selectedDeviceId.value)
  if (!last || !last.projectName) return
  const exists = projects.value.some(p => p.name === last.projectName)
    || (isMock && Boolean((MOCK_PROJECTS as Record<string, unknown>)[last.projectName]))
  if (!exists) return
  pendingViewState = last.viewState ?? null
  await openProject(last.projectName, last.fileName || undefined)
}

// ─── 运行状态同步（以设备为准，/debugger/state + TCP）──

const RUNTIME_POLL_INTERVAL = 5000

/** 查询设备运行状态；若设备在运行且未打开任何项目，自动打开运行中的项目 */
async function syncRuntimeState(deviceId: string) {
  await runtimeStore.syncFromDevice(deviceId)
  const s = runtimeStore.getState(deviceId)
  if (!s.running || !s.runningProject) return
  if (activeProject.value) return
  if (autoOpenedForDevice.value === deviceId) return
  const exists = projects.value.some(p => p.name === s.runningProject)
  if (!exists || opening.value) return
  autoOpenedForDevice.value = deviceId
  await openProject(s.runningProject)
}

function startRuntimePoll() {
  stopRuntimePoll()
  runtimePollTimer = setInterval(() => {
    if (selectedDeviceId.value) void syncRuntimeState(selectedDeviceId.value)
  }, RUNTIME_POLL_INTERVAL)
}

function stopRuntimePoll() {
  if (runtimePollTimer) {
    clearInterval(runtimePollTimer)
    runtimePollTimer = null
  }
}

function canToggleBreakpoint(file = activeFile.value): boolean {
  if (!file?.editable) return false
  const language = fileToMonacoLanguage(file)
  return language === 'lua' || language === 'python'
}

function toggleBreakpoint(line: number) {
  if (!activeFile.value || !canToggleBreakpoint(activeFile.value)) return
  const model = editor?.getModel()
  const safeLine = model ? Math.min(Math.max(line, 1), model.getLineCount()) : line
  const current = getFileBreakpoints(activeFile.value.name)
  const next = current.includes(safeLine)
    ? current.filter(item => item !== safeLine)
    : [...current, safeLine]
  setFileBreakpoints(activeFile.value.name, next)
  updateBreakpointDecorations()
}

function updateBreakpointDecorations() {
  const model = editor?.getModel()
  if (!model || !activeFile.value || !breakpointDecorations) return
  if (!canToggleBreakpoint(activeFile.value)) {
    breakpointDecorations.clear()
    return
  }
  const maxLine = model.getLineCount()
  const lines = getFileBreakpoints(activeFile.value.name).filter(line => line <= maxLine)
  breakpointDecorations.set(lines.map(line => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      glyphMarginClassName: 'breakpoint-glyph',
      glyphMarginHoverMessage: { value: `断点：第 ${line} 行` },
      overviewRuler: {
        color: '#f87171',
        position: monaco.editor.OverviewRulerLane.Left,
      },
    },
  })))
}

function parseErrorLines(message: string): number[] {
  const lines = new Set<number>()
  const patterns = [
    /(?:line|Line|行)\s*[:：]?\s*(\d+)/g,
    /[:：](\d+)[:：]/g,
    /(?:src\d+\.lua|main\.py|script\d+\.py|var\.py):(\d+)/g,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(message))) {
      const line = Number(match[1])
      if (Number.isFinite(line) && line > 0) lines.add(line)
    }
  }
  return [...lines]
}

async function loadAll() {
  loading.value = true
  try {
    if (isMock) {
      devices.value = Object.values(deviceStore.devices)
      if (routeDeviceId.value) selectedDeviceId.value = routeDeviceId.value
      else if (!selectedDeviceId.value && devices.value.length) selectedDeviceId.value = devices.value[0].id
      // Populate mock projects
      projects.value = Object.entries(MOCK_PROJECTS).map(([name, info]) => ({
        name, path: `/${name}${info.language === 'python' ? '.py' : '.lua'}`, language: info.language, size: 1024, modifiedAt: info.modifiedAt, files: info.files,
      }))
      recentProjects.value = [{ projectName: 'robot_test', projectPath: '/robot_test.lua', language: 'lua', openedAt: '2026-06-13T10:00:00Z' }]
      loading.value = false
      return
    }
    const deviceRes = await api.listDevices()
    if (deviceRes.success && deviceRes.data) {
      devices.value = deviceRes.data
      deviceStore.setDevices(deviceRes.data)
      if (routeDeviceId.value) selectedDeviceId.value = routeDeviceId.value
      else if (!selectedDeviceId.value && devices.value.length) selectedDeviceId.value = devices.value[0].id
    }
    if (selectedDeviceId.value) await loadProjects()
  } finally {
    loading.value = false
  }
}

/** 项目列表加载序号令牌：并发刷新只允许最新一次落地（与 refreshProjectContent 同模式） */
let projectsSeq = 0
async function loadProjects(opts?: { refresh?: boolean }) {
  if (!selectedDeviceId.value) return
  if (isMock) return
  const deviceId = selectedDeviceId.value
  // 最近项目（SQLite，快）并行请求并独立先行渲染，不被 SFTP 扫描阻塞
  void api.listRecentProjects(deviceId)
    .catch(() => null)
    .then(res => {
      if (res && res.success && res.data) recentProjects.value = res.data
    })

  const seq = ++projectsSeq
  loadingProjects.value = true
  try {
    const res = await api.listDeviceProjects(deviceId, opts)
    if (seq !== projectsSeq || selectedDeviceId.value !== deviceId) return
    if (res.success && res.data) {
      projects.value = res.data
      // 命中缓存：立即显示，后台强制刷新替换为最新
      if (res.cached) void refreshProjectsInBackground(deviceId, seq)
    } else {
      toastRef.value?.error(`加载项目失败：${res.error?.message}`)
    }
  } finally {
    if (seq === projectsSeq) loadingProjects.value = false
  }
}

/** 缓存命中后的后台列表刷新：强制扫描控制器并更新缓存/列表 */
async function refreshProjectsInBackground(deviceId: string, baseSeq: number) {
  const seq = ++projectsSeq
  try {
    const res = await api.listDeviceProjects(deviceId, { refresh: true })
    if (seq !== projectsSeq || selectedDeviceId.value !== deviceId) return
    if (res.success && res.data) projects.value = res.data
  } finally {
    if (seq === projectsSeq) loadingProjects.value = false
  }
}

function selectFile(fileName: string) {
  activeFileName.value = fileName
  syncEditor()
}

function chooseInitialFile(detail: api.ControllerProjectDetail) {
  const source = detail.fileList.find(file => file.name.endsWith('.lua') || file.name.endsWith('.py'))
  activeFileName.value = (openMode.value === 'source' ? source : detail.fileList[0])?.name ?? ''
}

/** 应用项目详情到界面（打开项目/创建/保存后共用） */
function applyProjectDetail(detail: api.ControllerProjectDetail, preferredFile?: string) {
  activeProject.value = detail
  // 重新打开项目：清掉该项目残留的脏标记，并以本次内容为保存基线
  dirtyFiles.value = dirtyFiles.value.filter(key => !key.includes(`/${detail.name}/`))
  setFileBaselines(detail)
  renameName.value = detail.name
  runtimeStore.reset(selectedDeviceId.value)
  clearExecutionLine()
  chooseInitialFile(detail)
  if (preferredFile && detail.fileList.some(file => file.name === preferredFile)) {
    activeFileName.value = preferredFile
  }
  syncEditor()
  loadPoints()
}

/**
 * 缓存命中后的后台同步：拉取控制器最新内容。
 * 同步成功前 Monaco 保持只读，避免与刷新内容冲突。
 * 用序号令牌处理并发：只允许最新一次刷新落地并恢复编辑状态。
 */
let refreshSeq = 0
async function refreshProjectContent(deviceId: string, projectName: string, preferredFile?: string) {
  const seq = ++refreshSeq
  refreshing.value = true
  editor?.updateOptions({ readOnly: true })
  try {
    const res = await api.openDeviceProject(deviceId, projectName, { refresh: true })
    if (seq !== refreshSeq || activeProject.value?.name !== projectName) return
    if (res.success && res.data) {
      // 保留当前文件与运行状态，仅替换内容（syncEditor 内容不变时不会跳光标）
      updateActiveProject(res.data, preferredFile || activeFileName.value)
      loadPoints()
      await loadProjects()
      if (res.stale) {
        toastRef.value?.info(`同步失败：${res.refreshError ?? '控制器不可达或工程不存在'}，已显示本地缓存内容`, {
          action: { label: '清除缓存', variant: 'danger', handler: () => { void clearProjectCache(deviceId, projectName) } },
          duration: 8000,
        })
      } else {
        toastRef.value?.success('已同步控制器最新内容')
      }
    } else {
      toastRef.value?.info(`同步失败：${res.error?.message || '控制器不可达'}，已显示本地缓存内容`)
    }
  } finally {
    if (seq === refreshSeq) {
      refreshing.value = false
      editor?.updateOptions({ readOnly: !activeFile.value?.editable })
    }
  }
}

/** 清除项目的本地缓存（详情 + 列表快照 + 最近记录），用于控制器上已无该工程的情况 */
async function clearProjectCache(deviceId: string, projectName: string) {
  const name = projectName
  const res = await api.clearProjectCache(deviceId, name)
  if (!res.success) {
    toastRef.value?.error(`清除缓存失败：${res.error?.message}`)
    return
  }
  dirtyFiles.value = dirtyFiles.value.filter(key => !key.includes(`/${name}/`))
  if (activeProject.value?.name === name) {
    activeProject.value = null
    activeFileName.value = ''
    runtimeStore.reset(selectedDeviceId.value)
    clearExecutionLine()
    syncEditor()
  }
  await loadProjects({ refresh: true })
  toastRef.value?.success('已清除本地缓存')
}

async function openProject(projectName: string, preferredFile?: string) {
  if (!selectedDeviceId.value) return
  if (isMock) {
    const lang = (MOCK_PROJECTS as Record<string, { language: ScriptLanguage }>)[projectName]?.language ?? 'lua'
    activeProject.value = makeMockDetail(projectName, lang)
    renameName.value = projectName
    runtimeStore.reset(selectedDeviceId.value)
    clearExecutionLine()
    chooseInitialFile(activeProject.value)
    if (preferredFile && activeProject.value.fileList.some(file => file.name === preferredFile)) {
      activeFileName.value = preferredFile
    }
    syncEditor()
    loadPoints()
    toastRef.value?.success(`[Mock] 已打开 ${projectName}`)
    return
  }
  const deviceId = selectedDeviceId.value
  opening.value = true
  openingProjectName.value = projectName
  try {
    const res = await api.openDeviceProject(deviceId, projectName)
    if (res.success && res.data) {
      if (res.cached) {
        // 缓存命中：秒开渲染（不走全屏 loading），后台刷新最新内容
        opening.value = false
        applyProjectDetail(res.data, preferredFile)
        if (res.stale) toastRef.value?.info('设备未连接，已显示本地缓存内容')
        void refreshProjectContent(deviceId, projectName, preferredFile)
      } else {
        applyProjectDetail(res.data, preferredFile)
        await loadProjects()
      }
    } else {
      toastRef.value?.error(`打开失败：${res.error?.message}`)
    }
  } finally {
    opening.value = false
    openingProjectName.value = ''
  }
}

async function createProject() {
  if (!selectedDeviceId.value || !newProjectName.value) return
  if (isMock) {
    activeProject.value = makeMockDetail(newProjectName.value, newProjectLanguage.value)
    // Add to mock project list so it appears in sidebar
    projects.value = [{ name: newProjectName.value, path: `/${newProjectName.value}.${newProjectLanguage.value === 'python' ? 'py' : 'lua'}`, language: newProjectLanguage.value, size: 512, modifiedAt: new Date().toISOString(), files: 1 }, ...projects.value]
    renameName.value = newProjectName.value
    newProjectName.value = ''
    chooseInitialFile(activeProject.value)
    syncEditor()
    projectPoints.value = []
    toastRef.value?.success('[Mock] 项目已创建')
    return
  }
  creating.value = true
  try {
    const res = await api.createDeviceProject(selectedDeviceId.value, newProjectName.value, newProjectLanguage.value)
    if (res.success && res.data) {
      activeProject.value = res.data
      setFileBaselines(res.data)
      renameName.value = res.data.name
      newProjectName.value = ''
      chooseInitialFile(res.data)
      await loadProjects({ refresh: true })
      syncEditor()
      projectPoints.value = []
      toastRef.value?.success('项目已创建')
    } else {
      toastRef.value?.error(`创建失败：${res.error?.message}`)
    }
  } finally {
    creating.value = false
  }
}

function updateActiveProject(detail: api.ControllerProjectDetail, preferredFile = activeFileName.value) {
  activeProject.value = detail
  // 以最新内容为保存基线（保存/增删文件/同步刷新后，脏标记由内容比对决定）
  setFileBaselines(detail)
  activeFileName.value = detail.fileList.find(file => file.name === preferredFile)?.name ?? detail.fileList[0]?.name ?? ''
  syncEditor()
}

// ─── Points ─────────────────────────────────────

async function loadPoints() {
  if (!selectedDeviceId.value || !activeProject.value) { projectPoints.value = []; return }
  if (isMock) { projectPoints.value = []; return }
  try {
    const res = await api.getPoints(selectedDeviceId.value, activeProject.value.name)
    if (res.success && res.data) projectPoints.value = res.data
    else projectPoints.value = []
  } catch { projectPoints.value = [] }
}

async function doSavePoint() {
  if (!selectedDeviceId.value || !activeProject.value) return
  if (isMock) {
    const n = projectPoints.value.length + 1
    projectPoints.value.push({ id: crypto.randomUUID(), name: `P${n}`, pose: [0,0,0,0,0,0], joint: [0,0,0,0,0,0], tool: 0, user: 0 })
    toastRef.value?.success(`[Mock] 已保存 P${n}`)
    return
  }
  savingPoint.value = true
  try {
    const res = await api.savePoint(selectedDeviceId.value, activeProject.value.name)
    if (res.success && res.data) {
      projectPoints.value.push(res.data)
      toastRef.value?.success(`已保存 ${res.data.name}`)
    } else {
      toastRef.value?.error(`保存点位失败：${res.error?.message}`)
    }
  } finally { savingPoint.value = false }
}

async function doDeletePoint(point: api.PointData) {
  if (!selectedDeviceId.value || !activeProject.value) return
  if (isMock) { projectPoints.value = projectPoints.value.filter(p => p.id !== point.id); return }
  deletingPoint.value = true
  try {
    const res = await api.deletePoint(selectedDeviceId.value, activeProject.value.name, point.id)
    if (res.success) {
      projectPoints.value = projectPoints.value.filter(p => p.id !== point.id)
      toastRef.value?.success(`已删除 ${point.name}`)
    } else {
      toastRef.value?.error(`删除失败：${res.error?.message}`)
    }
  } finally { deletingPoint.value = false }
}

async function doUpdatePoint(point: api.PointData) {
  if (!selectedDeviceId.value || !activeProject.value) return
  if (isMock) {
    point.joint = [...editingJoints.value]
    editingPointId.value = ''
    toastRef.value?.success(`[Mock] ${point.name} 已更新`)
    return
  }
  updatingPoint.value = true
  try {
    const res = await api.updatePoint(selectedDeviceId.value, activeProject.value.name, point.id, { joint: [...editingJoints.value] })
    if (res.success && res.data) {
      const idx = projectPoints.value.findIndex(p => p.id === point.id)
      if (idx >= 0) projectPoints.value[idx] = res.data
      editingPointId.value = ''
      toastRef.value?.success(`${point.name} 已更新`)
    } else {
      toastRef.value?.error(`更新失败：${res.error?.message}`)
    }
  } finally { updatingPoint.value = false }
}

// Populate editingJoints when editingPointId changes
watch(editingPointId, (id) => {
  if (!id) return
  const point = projectPoints.value.find(p => p.id === id)
  if (point) editingJoints.value = [...point.joint]
})

async function saveActiveFile() {
  if (!selectedDeviceId.value || !activeProject.value || !activeFile.value) return
  if (isMock) { toastRef.value?.info('[Mock] 文件已保存'); return }
  if (refreshing.value) {
    toastRef.value?.info('正在同步控制器内容，请稍候')
    return
  }
  if (!activeFile.value.editable) {
    toastRef.value?.error('生成的文件为只读')
    return
  }
  saving.value = true
  try {
    const fileName = activeFile.value.name
    const res = await api.updateProjectFile(selectedDeviceId.value, activeProject.value.name, fileName, activeFile.value.content)
    if (res.success && res.data) {
      setDirty(fileName, false)
      updateActiveProject(res.data, fileName)
      await loadProjects({ refresh: true })
      toastRef.value?.success('文件已保存')
    } else {
      toastRef.value?.error(`保存失败：${res.error?.message}`)
    }
  } finally {
    saving.value = false
  }
}

async function saveDirtyFiles() {
  if (isMock) return true
  if (!selectedDeviceId.value || !activeProject.value) return false
  for (const file of activeProject.value.fileList) {
    if (!isDirty(file.name) || !file.editable) continue
    const res = await api.updateProjectFile(selectedDeviceId.value, activeProject.value.name, file.name, file.content)
    if (!res.success || !res.data) {
      toastRef.value?.error(`保存失败：${res.error?.message}`)
      return false
    }
    setDirty(file.name, false)
    activeProject.value = res.data
    setFileBaselines(res.data)
  }
  return true
}

async function runProject() {
  if (!selectedDeviceId.value || !activeProject.value) return
  if (starting.value || running.value) {
    toastRef.value?.info('脚本正在运行中，请先停止')
    return
  }
  if (refreshing.value) {
    toastRef.value?.info('正在同步控制器内容，请稍候')
    return
  }
  const deviceId = selectedDeviceId.value
  if (isMock) {
    runtimeStore.reset(deviceId)
    runtimeStore.setRunning(deviceId, true)
    runtimeStore.addLog(deviceId, 'client', '[Mock] 正在运行项目...')
    toastRef.value?.success('[Mock] 已启动（按 F6 停止）')
    return
  }
  starting.value = true
  try {
    if (!(await saveDirtyFiles())) return
    runtimeStore.reset(deviceId)
    clearExecutionLine()
    const breakpointLines = buildDebuggerBreakpoints()
    runtimeStore.addLog(deviceId, 'client', `断点 ${JSON.stringify(breakpointLines)}`)
    const breakpointRes = await api.debuggerBreakPoint(deviceId, breakpointLines)
    if (!breakpointRes.success) {
      toastRef.value?.error(`设置断点失败：${breakpointRes.error?.message}`)
      return
    }
    const res = await api.runDeviceProject(deviceId, activeProject.value.name)
    if (res.success) {
      clearEditorMarkers()
      runtimeStore.setRunning(deviceId, true)
      toastRef.value?.success(`已启动 ${activeProject.value.name}`)
    } else {
      if (res.error?.message) markEditorError(res.error.message)
      toastRef.value?.error(`运行失败：${res.error?.message}`)
    }
  } finally {
    starting.value = false
  }
}

async function stopDebugger() {
  if (!selectedDeviceId.value) return
  const deviceId = selectedDeviceId.value
  if (isMock) {
    runtimeStore.setRunning(deviceId, false)
    runtimeStore.clearLine(deviceId)
    runtimeStore.getState(deviceId).cursorText = '已停止'
    toastRef.value?.info('[Mock] 已停止')
    return
  }
  stopping.value = true
  try {
    const res = await api.debuggerStop(deviceId)
    if (res.success) {
      runtimeStore.setRunning(deviceId, false)
      runtimeStore.clearLine(deviceId)
      runtimeStore.getState(deviceId).cursorText = '已停止'
      toastRef.value?.info('调试器已停止')
    }
    else toastRef.value?.error(`停止失败：${res.error?.message}`)
  } finally {
    stopping.value = false
  }
}

async function pauseDebugger() {
  if (!selectedDeviceId.value) return
  pausing.value = true
  try {
    const res = await api.debuggerSuspend(selectedDeviceId.value)
    if (res.success) toastRef.value?.info('调试器已暂停')
    else toastRef.value?.error(`暂停失败：${res.error?.message}`)
  } finally {
    pausing.value = false
  }
}

async function continueDebugger() {
  if (!selectedDeviceId.value) return
  continuing.value = true
  try {
    const res = await api.debuggerContinue(selectedDeviceId.value)
    if (res.success) toastRef.value?.info('调试器已继续')
    else toastRef.value?.error(`继续失败：${res.error?.message}`)
  } finally {
    continuing.value = false
  }
}

async function renameProject() {
  if (!selectedDeviceId.value || !activeProject.value || !renameName.value) return
  await renameProjectByName(activeProject.value.name, renameName.value)
}

function renameProjectFromList(projectName: string) {
  dialog.value = {
    kind: 'rename-project',
    projectName,
    fileName: '',
    input: projectName,
    message: '请输入新的控制器项目名称。',
  }
}

async function renameProjectByName(projectName: string, nextName: string) {
  if (!selectedDeviceId.value || !nextName) return
  renaming.value = true
  try {
    const oldName = projectName
    const res = await api.renameDeviceProject(selectedDeviceId.value, oldName, nextName)
    if (res.success && res.data) {
      dirtyFiles.value = dirtyFiles.value.filter(key => !key.includes(`/${oldName}/`))
      if (activeProject.value?.name === oldName) {
        updateActiveProject(res.data)
        renameName.value = res.data.name
      }
      await loadProjects({ refresh: true })
      toastRef.value?.success('项目已重命名')
    } else {
      toastRef.value?.error(`重命名失败：${res.error?.message}`)
    }
  } finally {
    renaming.value = false
  }
}

async function addFile() {
  if (!selectedDeviceId.value || !activeProject.value || !newFileName.value) return
  addingFile.value = true
  try {
    const res = await api.createProjectFile(selectedDeviceId.value, activeProject.value.name, newFileName.value, '')
    if (res.success && res.data) {
      const name = newFileName.value
      newFileName.value = ''
      updateActiveProject(res.data, name)
      await loadProjects({ refresh: true })
      toastRef.value?.success('文件已添加')
    } else {
      toastRef.value?.error(`添加失败：${res.error?.message}`)
    }
  } finally {
    addingFile.value = false
  }
}

async function deleteFile(fileName: string) {
  if (!selectedDeviceId.value || !activeProject.value) return
  dialog.value = {
    kind: 'delete-file',
    projectName: activeProject.value.name,
    fileName,
    input: '',
    message: `确认删除文件 ${fileName}？`,
  }
}

async function deleteFileConfirmed(projectName: string, fileName: string) {
  if (!selectedDeviceId.value) return
  const res = await api.deleteProjectFile(selectedDeviceId.value, projectName, fileName)
  if (res.success && res.data) {
    setDirty(fileName, false)
    updateActiveProject(res.data)
    await loadProjects({ refresh: true })
    toastRef.value?.success('文件已删除')
  } else {
    toastRef.value?.error(`删除失败：${res.error?.message}`)
  }
}

async function deleteProject() {
  if (!selectedDeviceId.value || !activeProject.value) return
  deleteProjectByName(activeProject.value.name)
}

function deleteProjectByName(projectName: string) {
  dialog.value = {
    kind: 'delete-project',
    projectName,
    fileName: '',
    input: '',
    message: `确认删除项目 ${projectName}？此操作将移除控制器上的项目文件夹。`,
  }
}

async function deleteProjectConfirmed(projectName: string) {
  if (!selectedDeviceId.value) return
  deletingProject.value = true
  try {
    const name = projectName
    const res = await api.deleteDeviceProject(selectedDeviceId.value, name)
    if (res.success) {
      dirtyFiles.value = dirtyFiles.value.filter(key => !key.includes(`/${name}/`))
      if (activeProject.value?.name === name) {
        activeProject.value = null
        activeFileName.value = ''
        runtimeStore.reset(selectedDeviceId.value)
        clearExecutionLine()
        syncEditor()
      }
      await loadProjects({ refresh: true })
      toastRef.value?.success('项目已删除')
    } else {
      toastRef.value?.error(`删除失败：${res.error?.message}`)
    }
  } finally {
    deletingProject.value = false
  }
}

function closeDialog() {
  dialog.value = { kind: '', projectName: '', fileName: '', input: '', message: '' }
}

async function confirmDialog() {
  const current = { ...dialog.value }
  if (!current.kind) return
  closeDialog()
  if (current.kind === 'rename-project') {
    const nextName = current.input.trim()
    if (!nextName || nextName === current.projectName) return
    await renameProjectByName(current.projectName, nextName)
  } else if (current.kind === 'delete-project') {
    await deleteProjectConfirmed(current.projectName)
  } else if (current.kind === 'delete-file') {
    await deleteFileConfirmed(current.projectName, current.fileName)
  }
}

watch(openMode, () => {
  if (!activeProject.value) return
  if (!visibleFiles.value.find(file => file.name === activeFileName.value)) {
    activeFileName.value = visibleFiles.value[0]?.name ?? ''
  }
  syncEditor()
})
watch(selectedDeviceId, async id => {
  if (!id) return
  wsClient.subscribe(id)
  activeProject.value = null
  activeFileName.value = ''
  autoOpenedForDevice.value = ''
  runtimeStore.reset(id)
  clearExecutionLine()
  await loadProjects()
  await syncRuntimeState(id)
})
watch(routeDeviceId, id => {
  if (id) selectedDeviceId.value = id
}, { immediate: true })

// 运行状态（store 由 WS 更新）→ 编辑器执行行 + 自动切换文件
watch(
  () => {
    const id = selectedDeviceId.value
    const s = id ? runtimeStore.states[id] : null
    return s && s.line > 0 ? `${s.line}:${s.fileName ?? ''}` : ''
  },
  key => {
    if (!key) return
    const id = selectedDeviceId.value
    if (!id) return
    const s = runtimeStore.getState(id)
    if (s.line > 0) {
      if (s.fileName && activeProject.value?.fileList.some(f => f.name === s.fileName)) {
        // 先切换文件（syncEditor 的 setValue 会丢装饰），nextTick 后再画执行行
        selectFile(s.fileName)
        nextTick(() => setExecutionLine(s.line))
      } else {
        setExecutionLine(s.line)
      }
    }
  }
)

// 日志自动滚动到底部
watch(runtimeLogs, () => {
  nextTick(() => {
    if (runtimeLogContainer.value) runtimeLogContainer.value.scrollTop = runtimeLogContainer.value.scrollHeight
  })
})

onMounted(async () => {
  await loadAll()
  await syncRuntimeState(selectedDeviceId.value)
  if (!activeProject.value) await restoreLastWorkspace()
  startRuntimePoll()
  window.addEventListener('pagehide', handlePageHide)
  ;(document.querySelector('.programming-page') as HTMLElement)?.focus()
})

function handlePageHide() {
  persistWorkspace(editor?.saveViewState() ?? null)
}

// 项目/文件变化时保存工作区（不含光标，避免跨文件错位）
watch([() => activeProject.value?.name, activeFileName], () => {
  persistWorkspace()
})

function onKeyDown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  // Ctrl+S / Cmd+S: Save
  if (mod && e.key === 's') { e.preventDefault(); saveActiveFile(); return }
  // Escape: focus editor
  if (e.key === 'Escape') { editor?.focus(); return }
  if (e.key === 'F9') { e.preventDefault(); runProject(); return }
  if (e.key === 'F6') { e.preventDefault(); stopDebugger(); return }
  if (e.key === 'F7') { e.preventDefault(); pauseDebugger(); return }
  if (e.key === 'F8') { e.preventDefault(); continueDebugger(); return }
}
onActivated(() => {
  // 切回本页：可能被 DeviceView 卸载时 unsubscribe 过，需重新订阅
  if (selectedDeviceId.value) {
    wsClient.subscribe(selectedDeviceId.value)
    void syncRuntimeState(selectedDeviceId.value)
  }
  startRuntimePoll()
  nextTick(() => {
    if (!editor) return
    editor.layout()
    if (savedEditorViewState) {
      editor.restoreViewState(savedEditorViewState)
      savedEditorViewState = null
    }
    const runtime = selectedDeviceId.value ? runtimeStore.getState(selectedDeviceId.value) : null
    if (runtime?.line && runtime.line > 0) setExecutionLine(runtime.line)
    editor.focus()
  })
})
onDeactivated(() => {
  stopRuntimePoll()
  savedEditorViewState = editor?.saveViewState() ?? null
  persistWorkspace(savedEditorViewState)
})
onBeforeUnmount(() => {
  stopRuntimePoll()
  window.removeEventListener('pagehide', handlePageHide)
  if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer)
  editorCursorSub?.dispose()
  editorScrollSub?.dispose()
  resizeObserver?.disconnect()
  cursorDecorations?.clear()
  breakpointDecorations?.clear()
  editor?.dispose()
  if (workerScope.__docatMonacoCompletionDisposables === completionDisposables) {
    completionDisposables.forEach(disposable => disposable.dispose())
    workerScope.__docatMonacoCompletionDisposables = []
  }
})
</script>

<style scoped>
.programming-page { padding: 40px 48px; max-width: 1700px; margin-inline: auto; min-height: 100vh; }
.workspace-header {
  display: grid; grid-template-columns: minmax(360px, 1fr) auto minmax(360px, 1fr);
  align-items: center; gap: 16px; padding-bottom: 12px;
}
.workspace-header-left { display: flex; align-items: center; gap: 20px; min-width: 0; }
.workspace-header-left h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
.workspace-header-center { display: flex; align-items: center; justify-content: center; min-width: 0; }
.workspace-header-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.back-btn { display: flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 0.82rem; font-weight: 500; color: var(--text-muted); text-decoration: none; transition: color var(--duration-fast); padding: 6px 0; }
.back-btn:hover { color: var(--cyan-300); }
.workspace-switch { display: flex; align-items: center; gap: 2px; }
.workspace-switch-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 0 12px;
  border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted);
  font-family: var(--font-body); font-size: 0.72rem; font-weight: 500;
  text-decoration: none; white-space: nowrap;
}
.workspace-switch-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.workspace-switch-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.workspace-switch-btn:hover { border-color: var(--border-bright); color: var(--text-primary); }
.workspace-switch-btn:active { transform: translateY(1px); }
.workspace-switch-btn--active { border-color: var(--cyan-500); background: var(--cyan-900); color: var(--cyan-300); }
.programming-grid { display: grid; grid-template-columns: 300px minmax(520px, 1fr) 390px; gap: 16px; align-items: stretch; }
.project-list-panel, .editor-panel, .run-panel { min-height: 700px; }
.run-panel { display: flex; flex-direction: column; gap: 14px; }
.side-section { display: flex; flex-direction: column; gap: 8px; }
.panel-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
.panel-title-right { display: inline-flex; align-items: center; gap: 6px; }
.project-section { margin-top: 16px; }
.project-section > .script-row + .script-row { margin-top: 6px; }
.script-count { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); }
.script-list { display: flex; flex-direction: column; gap: 6px; }
.list-loading-anchor { position: relative; min-height: 80px; }
.script-row {
  position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%;
  padding: 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--void-surface); color: var(--text-secondary); cursor: pointer; text-align: left;
}
.script-row:hover { border-color: var(--border-bright); color: var(--text-primary); }
.script-row:disabled { cursor: wait; opacity: 0.72; }
.script-row--active { border-color: var(--cyan-400); background: var(--cyan-800); color: var(--cyan-300); }
.script-row--loading { border-color: var(--amber-400); color: var(--amber-300); }
.script-row-name { font-family: var(--font-display); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; overflow-wrap: anywhere; }
.script-row-meta { font-family: var(--font-mono); font-size: 0.55rem; color: var(--text-muted); }
.project-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; gap: 6px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--void-surface);
}
.project-row:hover { border-color: var(--border-bright); }
.project-row--active { border-color: var(--cyan-400); background: var(--cyan-800); }
.project-row--loading { border-color: var(--amber-400); }
.project-row-main {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0;
  border: 0; background: transparent; color: var(--text-secondary); padding: 10px; cursor: pointer; text-align: left;
}
.project-row-main:disabled { cursor: wait; opacity: 0.72; }
.project-row--active .project-row-main { color: var(--cyan-300); }
.project-row-actions {
  display: flex; align-items: center; gap: 4px; padding: 6px; border-left: 1px solid var(--border);
}
.mini-action {
  border: 1px solid var(--border); background: transparent; color: var(--text-muted); border-radius: var(--radius);
  font-family: var(--font-display); font-size: 0.48rem; font-weight: 700; padding: 4px 6px; cursor: pointer;
}
.mini-action:hover { border-color: var(--cyan-400); color: var(--cyan-300); }
.mini-action:disabled { opacity: 0.45; cursor: not-allowed; }
.mini-action--danger { border-color: var(--red-700); color: var(--red-300); }
.mini-action--danger:hover { border-color: var(--red-300); color: var(--red-200); }
.empty-list, .editor-empty { font-family: var(--font-mono); color: var(--text-muted); text-align: center; padding: 40px 10px; }
.editor-empty { display: flex; flex-direction: column; justify-content: center; height: 100%; }
.editor-empty h3 { font-family: var(--font-display); font-size: 1rem; color: var(--text-secondary); }
.editor-empty p { margin-top: 8px; font-size: 0.75rem; }
.editor-panel { position: relative; }
.editor-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.editor-title { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.editor-title strong { font-family: var(--font-display); font-size: 0.82rem; color: var(--text-primary); overflow-wrap: anywhere; }
.editor-title span { font-family: var(--font-mono); font-size: 0.55rem; color: var(--text-muted); overflow-wrap: anywhere; }
.toolbar-actions, .create-row, .inline-row { display: flex; gap: 8px; align-items: center; min-width: 0; }
.create-row { flex-wrap: wrap; }
.mode-toggle { display: flex; gap: 2px; }
.mode-btn {
  padding: 7px 12px; border: 1px solid var(--border); background: var(--void-surface);
  color: var(--text-muted); cursor: pointer; font-family: var(--font-display); font-size: 0.55rem; font-weight: 700;
}
.mode-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.mode-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.mode-btn--active { background: var(--cyan-800); border-color: var(--cyan-400); color: var(--cyan-300); }
.file-tabs { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 8px; }
.file-tab {
  flex: 0 0 auto; max-width: 180px; padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--void-surface); color: var(--text-muted); cursor: pointer; font-family: var(--font-mono); font-size: 0.62rem;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.file-tab--active { border-color: var(--cyan-400); color: var(--cyan-300); background: var(--cyan-800); }
.file-tab--dirty::after { content: '*'; margin-left: 4px; color: var(--amber-400); }
.code-editor {
  width: 100%; height: 610px; overflow: hidden;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.code-editor:focus { border-color: var(--accent); box-shadow: var(--ring); }
.code-editor :deep(.monaco-editor),
.code-editor :deep(.overflow-guard) { border-radius: var(--radius); }
.code-editor :deep(.execution-line) { background: rgba(251, 191, 36, 0.16); }
.code-editor :deep(.execution-line-glyph) {
  background: var(--amber-400); width: 3px !important; margin-left: 3px;
}
.code-editor :deep(.breakpoint-glyph) {
  position: relative; cursor: pointer;
}
.code-editor :deep(.breakpoint-glyph::before) {
  content: ''; position: absolute; left: 5px; top: 5px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--red-300); box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.22);
}
.field-label { display: block; font-family: var(--font-display); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); }
.input, .select-input {
  padding: 8px 10px; font-family: var(--font-mono); font-size: 0.75rem;
  background: var(--void-surface); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none; min-width: 0;
}
.input { flex: 1; width: 100%; }
.select-input { width: 100%; margin-top: 6px; }
.select-input--compact { width: 96px; margin-top: 0; flex: 0 0 auto; }
.select-input:disabled { opacity: 0.78; cursor: not-allowed; }
.input:focus, .select-input:focus { border-color: var(--accent); box-shadow: var(--ring); }
.run-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.btn-wrap { display: inline-block; }
.btn-wrap > .btn { width: 100%; }
.deploy-info { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--void-surface); }
.info-row { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.info-row span { font-family: var(--font-display); font-size: 0.5rem; color: var(--text-muted); letter-spacing: 0.08em; }
.info-row strong { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-secondary); overflow-wrap: anywhere; font-weight: 400; }
.file-list { display: flex; flex-direction: column; gap: 6px; }
.file-row {
  position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px 8px;
  width: 100%; padding: 9px 54px 9px 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--void-surface); color: var(--text-secondary); cursor: pointer; text-align: left;
}
.file-row:hover { border-color: var(--border-bright); }
.file-row--active { border-color: var(--cyan-400); background: var(--cyan-800); color: var(--cyan-300); }
.file-row span { font-family: var(--font-mono); font-size: 0.66rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-row small { grid-column: 1 / -1; font-family: var(--font-mono); font-size: 0.52rem; color: var(--text-muted); }
.file-delete {
  position: absolute; right: 8px; top: 8px; border: 1px solid var(--red-700); background: transparent;
  color: var(--red-300); border-radius: var(--radius); font-family: var(--font-display); font-size: 0.5rem; padding: 3px 6px; cursor: pointer;
}
.runtime-panel {
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--void-surface);
  padding: 10px; min-height: 220px;
}
.runtime-cursor {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  border: 1px solid var(--border); border-radius: var(--radius); padding: 7px 8px; margin-bottom: 8px;
  font-family: var(--font-mono); font-size: 0.58rem; color: var(--text-muted);
}
.runtime-cursor strong { color: var(--amber-300); font-weight: 500; overflow-wrap: anywhere; text-align: right; }
.runtime-log-list {
  height: 230px; overflow: auto; display: flex; flex-direction: column; gap: 5px;
  border-top: 1px solid var(--border); padding-top: 8px;
}
.runtime-log-row {
  display: grid; grid-template-columns: 86px 58px minmax(0, 1fr); gap: 7px; align-items: start;
  font-family: var(--font-mono); font-size: 0.55rem; color: var(--text-secondary);
}
.runtime-log-row span { color: var(--text-muted); white-space: nowrap; overflow: hidden; }
.runtime-log-row strong { color: var(--cyan-300); font-weight: 600; }
.runtime-log-row p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.runtime-log-row--special strong { color: var(--amber-300); }
.runtime-log-row--popup strong { color: var(--green-300); }
.runtime-log-row--error strong,
.runtime-log-row--error p { color: var(--red-300); }

/* Points bar (below editor) */
.points-bar { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
.points-bar-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.points-bar-list { display: flex; gap: 4px; flex-wrap: wrap; }
.points-bar-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--void-surface); font-size: 11px;
}
.points-bar-chip strong { font-family: var(--font-display); font-size: 0.6rem; color: var(--cyan-300); }
.points-bar-chip small { font-family: var(--font-mono); font-size: 9px; color: var(--text-muted); }
.points-bar-del {
  width: 14px; height: 14px; display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; color: var(--text-muted);
  font-size: 12px; margin-left: 2px; border-radius: 2px;
}
.points-bar-del:hover { color: var(--status-danger); background: #ff174411; }
.points-bar-empty { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); padding: 4px 0; }
.points-bar-chip { cursor: pointer; }
.points-bar-chip--editing { border-color: var(--cyan-400); padding: 4px 8px; }
.points-edit-row { display: flex; align-items: center; gap: 3px; }
.points-edit-input {
  width: 52px; padding: 2px 4px; font-family: var(--font-mono); font-size: 0.65rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: 2px;
  color: var(--cyan-300); text-align: center; outline: none;
}
.points-edit-input:focus { border-color: var(--cyan-400); }

.runtime-empty { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); text-align: center; padding: 32px 0; }
.panel-loading,
.editor-loading {
  position: absolute; inset: 0; z-index: 5;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  border-radius: var(--radius); background: rgba(5, 9, 13, 0.72); backdrop-filter: blur(2px);
  color: var(--text-secondary); font-family: var(--font-display); font-size: 0.62rem; letter-spacing: 0.08em;
}
.editor-loading { min-height: 240px; }
.loading-ring {
  width: 18px; height: 18px; border: 2px solid rgba(125, 211, 252, 0.22);
  border-top-color: var(--cyan-300); border-radius: 50%; animation: spin 0.8s linear infinite;
}
.loading-ring--large { width: 24px; height: 24px; }
.loading-ring--small { width: 12px; height: 12px; flex: 0 0 auto; display: inline-block; }
.refresh-indicator {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-display); font-size: 0.55rem; font-weight: 700;
  letter-spacing: 0.08em; color: var(--amber-300); white-space: nowrap;
}
.modal-backdrop {
  position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.58); padding: 24px;
}
.modal-panel {
  width: min(420px, 100%); border: 1px solid var(--border-bright); border-radius: var(--radius);
  background: var(--void-panel); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42); padding: 16px;
}
.modal-message {
  margin: 8px 0 12px; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-secondary); line-height: 1.5;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1200px) {
  .workspace-header { grid-template-columns: 1fr; align-items: stretch; }
  .workspace-header-center { justify-content: flex-start; }
  .workspace-header-actions { justify-content: flex-start; }
  .programming-grid { grid-template-columns: 1fr; }
  .project-list-panel, .editor-panel, .run-panel { min-height: auto; }
}
</style>
