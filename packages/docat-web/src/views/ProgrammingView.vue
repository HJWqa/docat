<template>
  <div class="programming-page">
    <header class="workspace-header">
      <div class="workspace-header-left">
        <router-link to="/" class="back-btn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          DASHBOARD
        </router-link>
        <div>
          <h2>Programming</h2>
          <p class="header-subtitle">
            {{ routeDevice ? `${routeDevice.name} · ${routeDevice.ip}` : 'CONTROLLER PROJECTS · SFTP WORKSPACE' }}
          </p>
        </div>
      </div>
      <div class="workspace-header-center">
        <div class="workspace-switch">
          <router-link :to="routeDeviceId ? `/device/${routeDeviceId}` : '/'" class="workspace-switch-btn">
            {{ routeDeviceId ? 'CONTROL' : 'DASHBOARD' }}
          </router-link>
          <router-link :to="routeDeviceId ? `/device/${routeDeviceId}/programming` : '/programming'" class="workspace-switch-btn workspace-switch-btn--active">
            PROGRAMMING
          </router-link>
        </div>
      </div>
      <div class="workspace-header-actions">
        <button class="btn btn-secondary" @click="loadAll" :disabled="loading">
          {{ loading ? 'LOADING...' : 'REFRESH' }}
        </button>
      </div>
    </header>

    <div class="programming-grid mt-2">
      <aside class="project-list-panel card">
        <label class="field-label">DEVICE</label>
        <select v-model="selectedDeviceId" class="select-input" :disabled="Boolean(routeDeviceId)">
          <option value="">Select device</option>
          <option v-for="device in devices" :key="device.id" :value="device.id">
            {{ device.name }} · {{ device.ip }}
          </option>
        </select>

        <div class="create-row mt-1">
          <input v-model.trim="newProjectName" class="input" placeholder="Project name" />
          <select v-model="newProjectLanguage" class="select-input select-input--compact">
            <option value="lua">Lua</option>
            <option value="python">Python</option>
            <option value="blockly">Blockly</option>
          </select>
          <button class="btn btn-primary btn-sm" :disabled="!selectedDeviceId || !newProjectName || creating" @click="createProject">
            {{ creating ? 'NEW...' : 'NEW' }}
          </button>
        </div>

        <div v-if="recentProjects.length" class="project-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">RECENT</span>
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
            <span class="hud-label" style="margin-bottom:0">PROJECTS</span>
            <span class="script-count">{{ projects.length }}</span>
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
                  {{ openingProjectName === project.name ? 'OPENING...' : `${project.language.toUpperCase()} · ${project.files} files` }}
                </span>
              </button>
              <div class="project-row-actions">
                <button class="mini-action" @click="renameProjectFromList(project.name)" :disabled="opening || renaming">REN</button>
                <button class="mini-action mini-action--danger" @click="deleteProjectByName(project.name)" :disabled="opening || deletingProject">DEL</button>
              </div>
            </div>
            <div v-if="!projects.length" class="empty-list">No controller projects</div>
            <div v-if="loadingProjects" class="panel-loading">
              <span class="loading-ring"></span>
              <strong>LOADING PROJECTS</strong>
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
              <button :class="['mode-btn', { 'mode-btn--active': openMode === 'source' }]" @click="openMode = 'source'">SOURCE</button>
              <button :class="['mode-btn', { 'mode-btn--active': openMode === 'all' }]" @click="openMode = 'all'">ALL</button>
            </div>
            <button class="btn btn-primary btn-sm" @click="saveActiveFile" :disabled="!activeFile || !activeFile.editable || saving">
              {{ saving ? 'SAVING...' : 'SAVE' }}
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

        <div v-else class="editor-empty">
          <h3>NO PROJECT OPEN</h3>
          <p>Select a controller project to edit its files.</p>
        </div>

        <div v-if="opening" class="editor-loading">
          <span class="loading-ring loading-ring--large"></span>
          <strong>{{ openingProjectName ? `OPENING ${openingProjectName}` : 'OPENING PROJECT' }}</strong>
        </div>

      </main>

      <aside class="run-panel card">
        <div v-if="activeProject" class="side-section">
          <span class="hud-label">CONTROL</span>
          <div class="run-actions">
          <button class="btn btn-success" :disabled="running || !selectedDeviceId" @click="runProject">
            {{ running ? 'STARTING...' : 'RUN' }}
          </button>
          <button class="btn btn-danger" :disabled="stopping || !selectedDeviceId" @click="stopDebugger">
            {{ stopping ? 'STOPPING...' : 'STOP' }}
          </button>
            <button class="btn btn-secondary" :disabled="pausing || !selectedDeviceId" @click="pauseDebugger">
              {{ pausing ? 'PAUSING...' : 'PAUSE' }}
            </button>
            <button class="btn btn-secondary" :disabled="continuing || !selectedDeviceId" @click="continueDebugger">
              {{ continuing ? 'CONTINUING...' : 'CONTINUE' }}
            </button>
          </div>
        </div>

        <div v-if="activeProject" class="runtime-panel side-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">RUN LOG</span>
            <button class="btn btn-secondary btn-sm" @click="runtimeLogs = []">CLEAR</button>
          </div>
          <div class="runtime-cursor">
            <span>Cursor</span>
            <strong>{{ runtimeCursorText || '--' }}</strong>
          </div>
          <div ref="runtimeLogContainer" class="runtime-log-list">
            <div v-for="entry in runtimeLogs" :key="entry.id" :class="['runtime-log-row', `runtime-log-row--${entry.level}`]">
              <span>{{ formatTime(entry.time) }}</span>
              <strong>{{ entry.level }}</strong>
              <p>{{ entry.text }}</p>
            </div>
            <div v-if="!runtimeLogs.length" class="runtime-empty">No runtime logs</div>
          </div>
        </div>

        <div v-if="activeProject" class="file-list side-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">FILES</span>
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
              DEL
            </button>
          </button>
        </div>

        <div v-if="activeProject" class="project-tools side-section">
          <span class="hud-label">FILE TOOLS</span>
          <label class="field-label">RENAME PROJECT</label>
          <div class="inline-row">
            <input v-model.trim="renameName" class="input" />
            <button class="btn btn-secondary btn-sm" :disabled="!renameName || renaming" @click="renameProject">
              RENAME
            </button>
          </div>

          <label class="field-label mt-1">ADD FILE</label>
          <div class="inline-row">
            <input v-model.trim="newFileName" class="input" placeholder="file.lua" />
            <button class="btn btn-secondary btn-sm" :disabled="!newFileName || addingFile" @click="addFile">
              ADD
            </button>
          </div>
        </div>

        <div v-if="activeProject" class="side-section">
          <div class="panel-title-row">
            <span class="hud-label" style="margin-bottom:0">PROJECT</span>
            <button class="btn btn-danger btn-sm" :disabled="deletingProject" @click="deleteProject">DELETE</button>
          </div>
          <div class="deploy-info">
            <div class="info-row">
              <span>Name</span>
              <strong>{{ activeProject.name }}</strong>
            </div>
            <div class="info-row">
              <span>Modified</span>
              <strong>{{ formatTime(activeProject.modifiedAt) }}</strong>
            </div>
            <div class="info-row">
              <span>Files</span>
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
          <button class="mini-action" @click="closeDialog">ESC</button>
        </div>
        <p class="modal-message">{{ dialog.message }}</p>
        <input
          v-if="dialog.kind === 'rename-project'"
          v-model.trim="dialog.input"
          class="input"
          @keyup.enter="confirmDialog"
        />
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" @click="closeDialog">CANCEL</button>
          <button
            :class="['btn', dialogDanger ? 'btn-danger' : 'btn-primary', 'btn-sm']"
            :disabled="dialog.kind === 'rename-project' && !dialog.input"
            @click="confirmDialog"
          >
            CONFIRM
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
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/min/vs/editor/editor.main.css'
import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import * as api from '../services/api'
import { wsClient } from '../services/ws'
import { DOBOT_API_CATALOG } from '../services/dobotApiCatalog'
import { deviceStore } from '../stores/deviceStore'
import Toast from '../components/Toast.vue'
import type { DeviceConfig, ScriptLanguage } from 'docat-shared/types'

type MonacoLanguage = 'lua' | 'python'
type OpenMode = 'source' | 'all'
type RuntimeLevel = 'client' | 'special' | 'popup' | 'error'
type DialogKind = '' | 'rename-project' | 'delete-project' | 'delete-file'

interface RuntimeLogEntry {
  id: number
  time: string
  level: RuntimeLevel
  text: string
}

interface RuntimeMessage {
  port?: number
  level?: RuntimeLevel
  data?: string
  timestamp?: number
}

defineOptions({ name: 'ProgrammingView' })

const workerScope = self as unknown as {
  MonacoEnvironment?: monaco.Environment
  __docatMonacoCompletionDisposables?: Array<{ dispose: () => void }>
}
workerScope.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

const route = useRoute()
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
const runtimeLogs = ref<RuntimeLogEntry[]>([])
const runtimeCursorText = ref('')
const loading = ref(false)
const loadingProjects = ref(false)
const opening = ref(false)
const openingProjectName = ref('')
const creating = ref(false)
const saving = ref(false)
const running = ref(false)
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
  if (dialog.value.kind === 'rename-project') return 'RENAME PROJECT'
  if (dialog.value.kind === 'delete-project') return 'DELETE PROJECT'
  if (dialog.value.kind === 'delete-file') return 'DELETE FILE'
  return ''
})
const dialogDanger = computed(() => dialog.value.kind === 'delete-project' || dialog.value.kind === 'delete-file')

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let cursorDecorations: monaco.editor.IEditorDecorationsCollection | null = null
let breakpointDecorations: monaco.editor.IEditorDecorationsCollection | null = null
let resizeObserver: ResizeObserver | null = null
let syncingEditor = false
let runtimeLogId = 0
let monacoConfiguredForInstance = false
let completionDisposables: Array<{ dispose: () => void }> = []
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
      'editor.background': '#05090d',
      'editor.foreground': '#d8e7ff',
      'editorLineNumber.foreground': '#496384',
      'editorLineNumber.activeForeground': '#22d3ee',
      'editorCursor.foreground': '#22d3ee',
      'editor.selectionBackground': '#164e63',
      'editor.lineHighlightBackground': '#0b1628',
      'editorGutter.background': '#05090d',
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
    fontFamily: "'JetBrains Mono', 'Share Tech Mono', monospace",
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
    readOnly: !activeFile.value?.editable,
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
  editor.onDidChangeModelContent(() => {
    if (!editor || syncingEditor || !activeFile.value) return
    activeFile.value.content = editor.getValue()
    setDirty(activeFile.value.name, true)
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
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, fileToMonacoLanguage(file))
    editor.updateOptions({ readOnly: !file?.editable })
    if (editor.getValue() !== (file?.content ?? '')) {
      syncingEditor = true
      editor.setValue(file?.content ?? '')
      syncingEditor = false
    }
    updateBreakpointDecorations()
    editor.layout()
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
  cursorDecorations?.clear()
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
      glyphMarginHoverMessage: { value: `Breakpoint line ${line}` },
      overviewRuler: {
        color: '#f87171',
        position: monaco.editor.OverviewRulerLane.Left,
      },
    },
  })))
}

function isRuntimeFinishText(text: string): boolean {
  return /(?:\.py:finish|\.lua:finish|:finish\b|script executed|script finished|执行完成|运行完成|程序结束|\bdone\b)/i.test(text)
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

function parseRuntimeCursor(payload: unknown): { fileName?: string; line?: number; text: string } {
  const data = typeof payload === 'object' && payload
    ? String((payload as RuntimeMessage).data ?? '')
    : String(payload ?? '')
  const text = data.trim()
  if (!text) return { text }

  try {
    const json = JSON.parse(text) as Record<string, unknown>
    const fileName = typeof json.file === 'string' ? json.file : typeof json.thread === 'string' ? json.thread : undefined
    const line = Number(json.line ?? json.progress)
    return { fileName, line: Number.isFinite(line) && line > 0 ? line : undefined, text }
  } catch {
    // raw controller message
  }

  const fileMatch = /(?:^|[/\s])([^/\s:]+\.(?:lua|py)):(\d+)/.exec(text)
  if (fileMatch) {
    return { fileName: fileMatch[1], line: Number(fileMatch[2]), text }
  }

  const numberMatch = /^(\d+)$/.exec(text) || /(?:line|Line|行)\s*[:：]?\s*(\d+)/.exec(text)
  if (numberMatch) return { line: Number(numberMatch[1]), text }

  return { text }
}

function appendRuntimeLog(payload: unknown) {
  const message = (typeof payload === 'object' && payload ? payload as RuntimeMessage : {}) as RuntimeMessage
  const rawText = String(message.data ?? payload ?? '').trim()
  if (!rawText) return
  const isError = /(?:ERROR|ALARM|error|Traceback|Exception)/.test(rawText)
  const entry: RuntimeLogEntry = {
    id: ++runtimeLogId,
    time: new Date(message.timestamp ?? Date.now()).toISOString(),
    level: isError ? 'error' : message.level ?? 'client',
    text: rawText,
  }
  runtimeLogs.value = [...runtimeLogs.value.slice(-199), entry]
  nextTick(() => {
    if (runtimeLogContainer.value) runtimeLogContainer.value.scrollTop = runtimeLogContainer.value.scrollHeight
  })
}

function handleRuntimeLog(deviceId: string, payload: unknown) {
  if (deviceId !== selectedDeviceId.value) return
  appendRuntimeLog(payload)
  const text = typeof payload === 'object' && payload ? String((payload as RuntimeMessage).data ?? '') : String(payload ?? '')
  if (isRuntimeFinishText(text)) {
    clearExecutionLine()
    runtimeCursorText.value = 'FINISHED'
    return
  }
  const fileMatch = /([^/\s:]+\.(?:lua|py)):(\d+)/.exec(text)
  if (fileMatch) {
    const line = Number(fileMatch[2])
    const fileName = fileMatch[1]
    if (activeProject.value?.fileList.some(file => file.name === fileName)) selectFile(fileName)
    if (Number.isFinite(line) && line > 0) nextTick(() => setExecutionLine(line))
  }
}

function handleRuntimeCursor(deviceId: string, payload: unknown) {
  if (deviceId !== selectedDeviceId.value) return
  const cursor = parseRuntimeCursor(payload)
  if (isRuntimeFinishText(cursor.text)) {
    clearExecutionLine()
    runtimeCursorText.value = 'FINISHED'
    return
  }
  runtimeCursorText.value = cursor.text || (cursor.line ? `line ${cursor.line}` : '')
  if (cursor.fileName && activeProject.value?.fileList.some(file => file.name === cursor.fileName)) {
    selectFile(cursor.fileName)
  }
  if (cursor.line) nextTick(() => setExecutionLine(cursor.line!))
}

async function loadAll() {
  loading.value = true
  try {
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

async function loadProjects() {
  if (!selectedDeviceId.value) return
  loadingProjects.value = true
  try {
    const [projectRes, recentRes] = await Promise.all([
      api.listDeviceProjects(selectedDeviceId.value),
      api.listRecentProjects(selectedDeviceId.value),
    ])
    if (projectRes.success && projectRes.data) projects.value = projectRes.data
    else toastRef.value?.error(`Projects failed: ${projectRes.error?.message}`)
    if (recentRes.success && recentRes.data) recentProjects.value = recentRes.data
  } finally {
    loadingProjects.value = false
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

async function openProject(projectName: string) {
  if (!selectedDeviceId.value) return
  opening.value = true
  openingProjectName.value = projectName
  try {
    const res = await api.openDeviceProject(selectedDeviceId.value, projectName)
    if (res.success && res.data) {
      activeProject.value = res.data
      renameName.value = res.data.name
      runtimeLogs.value = []
      runtimeCursorText.value = ''
      clearExecutionLine()
      chooseInitialFile(res.data)
      await loadProjects()
      syncEditor()
    } else {
      toastRef.value?.error(`Open failed: ${res.error?.message}`)
    }
  } finally {
    opening.value = false
    openingProjectName.value = ''
  }
}

async function createProject() {
  if (!selectedDeviceId.value || !newProjectName.value) return
  creating.value = true
  try {
    const res = await api.createDeviceProject(selectedDeviceId.value, newProjectName.value, newProjectLanguage.value)
    if (res.success && res.data) {
      activeProject.value = res.data
      renameName.value = res.data.name
      newProjectName.value = ''
      chooseInitialFile(res.data)
      await loadProjects()
      syncEditor()
      toastRef.value?.success('Project created')
    } else {
      toastRef.value?.error(`Create failed: ${res.error?.message}`)
    }
  } finally {
    creating.value = false
  }
}

function updateActiveProject(detail: api.ControllerProjectDetail, preferredFile = activeFileName.value) {
  activeProject.value = detail
  activeFileName.value = detail.fileList.find(file => file.name === preferredFile)?.name ?? detail.fileList[0]?.name ?? ''
  syncEditor()
}

async function saveActiveFile() {
  if (!selectedDeviceId.value || !activeProject.value || !activeFile.value) return
  if (!activeFile.value.editable) {
    toastRef.value?.error('Generated file is read-only')
    return
  }
  saving.value = true
  try {
    const fileName = activeFile.value.name
    const res = await api.updateProjectFile(selectedDeviceId.value, activeProject.value.name, fileName, activeFile.value.content)
    if (res.success && res.data) {
      setDirty(fileName, false)
      updateActiveProject(res.data, fileName)
      await loadProjects()
      toastRef.value?.success('File saved')
    } else {
      toastRef.value?.error(`Save failed: ${res.error?.message}`)
    }
  } finally {
    saving.value = false
  }
}

async function saveDirtyFiles() {
  if (!selectedDeviceId.value || !activeProject.value) return false
  for (const file of activeProject.value.fileList) {
    if (!isDirty(file.name) || !file.editable) continue
    const res = await api.updateProjectFile(selectedDeviceId.value, activeProject.value.name, file.name, file.content)
    if (!res.success || !res.data) {
      toastRef.value?.error(`Save failed: ${res.error?.message}`)
      return false
    }
    setDirty(file.name, false)
    activeProject.value = res.data
  }
  return true
}

async function runProject() {
  if (!selectedDeviceId.value || !activeProject.value) return
  running.value = true
  try {
    if (!(await saveDirtyFiles())) return
    runtimeLogs.value = []
    runtimeCursorText.value = ''
    clearExecutionLine()
    const breakpointLines = buildDebuggerBreakpoints()
    appendRuntimeLog({ level: 'client', data: `Breakpoints ${JSON.stringify(breakpointLines)}` })
    const breakpointRes = await api.debuggerBreakPoint(selectedDeviceId.value, breakpointLines)
    if (!breakpointRes.success) {
      toastRef.value?.error(`Breakpoints failed: ${breakpointRes.error?.message}`)
      return
    }
    const res = await api.runDeviceProject(selectedDeviceId.value, activeProject.value.name)
    if (res.success) {
      clearEditorMarkers()
      toastRef.value?.success(`Started ${activeProject.value.name}`)
    } else {
      if (res.error?.message) markEditorError(res.error.message)
      toastRef.value?.error(`Run failed: ${res.error?.message}`)
    }
  } finally {
    running.value = false
  }
}

async function stopDebugger() {
  if (!selectedDeviceId.value) return
  stopping.value = true
  try {
    const res = await api.debuggerStop(selectedDeviceId.value)
    if (res.success) {
      clearExecutionLine()
      runtimeCursorText.value = 'STOPPED'
      toastRef.value?.info('Debugger stopped')
    }
    else toastRef.value?.error(`Stop failed: ${res.error?.message}`)
  } finally {
    stopping.value = false
  }
}

async function pauseDebugger() {
  if (!selectedDeviceId.value) return
  pausing.value = true
  try {
    const res = await api.debuggerSuspend(selectedDeviceId.value)
    if (res.success) toastRef.value?.info('Debugger paused')
    else toastRef.value?.error(`Pause failed: ${res.error?.message}`)
  } finally {
    pausing.value = false
  }
}

async function continueDebugger() {
  if (!selectedDeviceId.value) return
  continuing.value = true
  try {
    const res = await api.debuggerContinue(selectedDeviceId.value)
    if (res.success) toastRef.value?.info('Debugger continued')
    else toastRef.value?.error(`Continue failed: ${res.error?.message}`)
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
    message: 'Enter a new controller project name.',
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
      await loadProjects()
      toastRef.value?.success('Project renamed')
    } else {
      toastRef.value?.error(`Rename failed: ${res.error?.message}`)
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
      await loadProjects()
      toastRef.value?.success('File added')
    } else {
      toastRef.value?.error(`Add failed: ${res.error?.message}`)
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
    message: `Delete file ${fileName}?`,
  }
}

async function deleteFileConfirmed(projectName: string, fileName: string) {
  if (!selectedDeviceId.value) return
  const res = await api.deleteProjectFile(selectedDeviceId.value, projectName, fileName)
  if (res.success && res.data) {
    setDirty(fileName, false)
    updateActiveProject(res.data)
    await loadProjects()
    toastRef.value?.success('File deleted')
  } else {
    toastRef.value?.error(`Delete failed: ${res.error?.message}`)
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
    message: `Delete project ${projectName}? This removes the controller project folder.`,
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
        runtimeLogs.value = []
        runtimeCursorText.value = ''
        clearExecutionLine()
        syncEditor()
      }
      await loadProjects()
      toastRef.value?.success('Project deleted')
    } else {
      toastRef.value?.error(`Delete failed: ${res.error?.message}`)
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
  runtimeLogs.value = []
  runtimeCursorText.value = ''
  clearExecutionLine()
  await loadProjects()
})
watch(routeDeviceId, id => {
  if (id) selectedDeviceId.value = id
}, { immediate: true })

onMounted(() => {
  wsClient.onRuntimeLog(handleRuntimeLog)
  wsClient.onRuntimeCursor(handleRuntimeCursor)
  loadAll()
})
onActivated(() => {
  nextTick(() => editor?.layout())
})
onDeactivated(() => undefined)
onBeforeUnmount(() => {
  wsClient.onRuntimeLog(() => undefined)
  wsClient.onRuntimeCursor(() => undefined)
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
.programming-page { padding: 40px 48px; max-width: 1700px; min-height: 100vh; }
.workspace-header {
  display: grid; grid-template-columns: minmax(360px, 1fr) auto minmax(360px, 1fr);
  align-items: center; gap: 16px; padding-bottom: 12px;
}
.workspace-header-left { display: flex; align-items: center; gap: 20px; min-width: 0; }
.workspace-header-left h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; color: var(--text-primary); letter-spacing: 0.06em; }
.workspace-header-center { display: flex; align-items: center; justify-content: center; min-width: 0; }
.workspace-header-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.back-btn { display: flex; align-items: center; gap: 6px; font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; color: var(--text-muted); text-decoration: none; transition: color var(--duration-fast); padding: 6px 0; white-space: nowrap; }
.back-btn:hover { color: var(--cyan-300); }
.workspace-switch { display: flex; align-items: center; gap: 2px; }
.workspace-switch-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 0 12px;
  border: 1px solid var(--border); background: var(--void-surface); color: var(--text-muted);
  font-family: var(--font-display); font-size: 0.55rem; font-weight: 800; letter-spacing: 0.08em;
  text-decoration: none; white-space: nowrap;
}
.workspace-switch-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.workspace-switch-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.workspace-switch-btn:hover { border-color: var(--border-bright); color: var(--text-primary); }
.workspace-switch-btn--active { border-color: var(--cyan-400); background: var(--cyan-800); color: var(--cyan-300); }
.programming-grid { display: grid; grid-template-columns: 300px minmax(520px, 1fr) 390px; gap: 16px; align-items: stretch; }
.project-list-panel, .editor-panel, .run-panel { min-height: 700px; }
.run-panel { display: flex; flex-direction: column; gap: 14px; }
.side-section { display: flex; flex-direction: column; gap: 8px; }
.panel-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
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
  background: #05090d; border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.code-editor:focus { border-color: var(--cyan-400); box-shadow: 0 0 8px var(--cyan-glow); }
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
.input:focus, .select-input:focus { border-color: var(--cyan-400); box-shadow: 0 0 6px var(--cyan-glow); }
.run-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
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
.runtime-log-row strong { color: var(--cyan-300); text-transform: uppercase; font-weight: 500; }
.runtime-log-row p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.runtime-log-row--special strong { color: var(--amber-300); }
.runtime-log-row--popup strong { color: var(--green-300); }
.runtime-log-row--error strong,
.runtime-log-row--error p { color: var(--red-300); }
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
