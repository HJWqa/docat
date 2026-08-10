<template>
  <div class="script-panel">
    <div class="script-toolbar">
      <button class="btn btn-success btn-sm" :disabled="!hasContent || running" @click="runScriptAction" title="运行脚本">
        ▶ 运行
      </button>
      <button class="btn btn-secondary btn-sm" :disabled="!hasContent" @click="rerunScript" title="终止当前并重新运行">
        ↻ 重新运行
      </button>
      <button class="btn btn-danger btn-sm" :disabled="!running" @click="stopScript" title="终止脚本">
        ⏹ 终止
      </button>
      <span class="toolbar-sep" />
      <button v-if="!isMock" class="btn btn-primary btn-sm" :disabled="!dirty || saving" @click="saveFile" title="保存到服务端">
        {{ saving ? '保存中...' : '💾 保存' }}
      </button>
      <button class="btn btn-secondary btn-sm" :disabled="!fileName" @click="reloadFile" title="忽略当前修改，从文件重新读取">
        🔄 重新读取文件
      </button>
      <template v-if="isMock">
        <button class="btn btn-secondary btn-sm" @click="pickFile" title="选择本地脚本文件">
          📂 选择文件
        </button>
        <button class="btn btn-secondary btn-sm" @click="loadExample" title="载入内置示例脚本">
          📄 示例
        </button>
        <label class="follow-toggle" title="跟随本地文件变动实时刷新">
          <input v-model="followEnabled" type="checkbox" :disabled="!fileHandle" @change="onFollowChange" />
          <span class="follow-track"><span class="follow-thumb" /></span>
          <span class="follow-text">跟随文件</span>
        </label>
        <input ref="fileInputRef" type="file" accept=".js,.mjs,.cjs,.py" hidden @change="onFileInput" />
      </template>
      <template v-else>
        <select v-model="fileName" class="file-select" @change="onServerFileSelect">
          <option value="">选择服务端脚本文件</option>
          <option v-for="f in fileList" :key="f.name" :value="f.name">{{ f.name }}</option>
        </select>
        <button class="btn btn-secondary btn-sm" :disabled="loadingFiles" @click="refreshFileList" title="刷新服务端文件列表">
          {{ loadingFiles ? '…' : '↻ 列表' }}
        </button>
        <button class="btn btn-secondary btn-sm" :disabled="openingEditor" @click="openInEditor" title="在服务端用 VSCode 打开脚本目录">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4.5 4 1.5 8l3 4M11.5 4l3 4-3 4M9 3.5 7 12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ openingEditor ? '…' : 'VSCode' }}
        </button>
      </template>
    </div>

    <div class="file-bar">
      <span class="file-name">{{ fileName || '未选择脚本文件' }}</span>
      <span v-if="!isMock && orchStore.settings.scriptsDir" class="file-meta" title="服务端脚本目录">
        目录: {{ orchStore.settings.scriptsDir }}
      </span>
      <span v-if="fileName" class="file-meta">
        {{ fileLanguageLabel }} · {{ formatSize(fileSize) }} · {{ formatTime(lastModified) }}
      </span>
      <span v-if="dirty" class="dirty-badge">● 未保存修改</span>
      <span v-if="running" class="run-badge">● 运行中 {{ runningSeconds }}s</span>
      <span v-if="fileChangedWhileRunning" class="run-badge run-badge--warn">⚠ 文件已更新，请重新运行</span>
    </div>

    <Transition name="fade">
      <div v-if="externalUpdate" class="update-banner">
        <span>文件已在{{ isMock ? '本地' : '服务端' }}更新，当前有未保存的修改</span>
        <button class="btn btn-danger btn-xs" @click="discardAndReload">忽略修改重载</button>
        <button class="btn btn-secondary btn-xs" @click="externalUpdate = false">保持当前修改</button>
      </div>
    </Transition>

    <div ref="editorContainer" class="script-editor" />

    <div class="script-hint">
      <span>API：</span>
      <code>devices.send(设备名, 文本)</code>
      <code>devices.onMessage(设备名, cb)</code>
      <code>poses.get(姿态名)</code>
      <code>poses.get(姿态名, ';')</code>
      <code>utils.toArray(文本)</code>
      <code>utils.toString(数组)</code>
      <code>utils.sleep(ms)</code>
      <code>log.info / warn / error</code>
    </div>

    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/features/register.all'
import 'monaco-editor/languages/definitions/javascript/register'
import 'monaco-editor/languages/definitions/python/register'
import { addLog, isOrchMockMode, onOrchScriptChange, onOrchScriptsDirChange, orchStore } from '../../stores/orchestrationStore'
import { pickScriptFile, runScript, watchScriptFile, type ScriptRunHandle } from '../../services/orchestration'
import { orchGetScript, orchListScripts, orchOpenScriptsInEditor, orchSaveScript, type OrchScriptFileInfo } from '../../services/orchApi'
import Toast from '../Toast.vue'

type ScriptLanguage = 'javascript' | 'python'

const isMock = isOrchMockMode()
const toastRef = ref<InstanceType<typeof Toast>>()
const editorContainer = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const fileName = ref('')
const fileLanguage = ref<ScriptLanguage>('javascript')
/** 编辑器当前内容 */
const fileContent = ref('')
/** 最近一次从文件源（服务端/本地）同步的内容 */
const lastSynced = ref('')
const fileSize = ref(0)
const lastModified = ref(0)
/** 真实模式：服务端文件 mtime 基准 */
const serverMtime = ref(0)
/** 真实模式：自己保存后短暂忽略 WS 事件，避免回环 */
let suppressUntil = 0

const fileList = ref<OrchScriptFileInfo[]>([])
const loadingFiles = ref(false)
const saving = ref(false)
const openingEditor = ref(false)

const fileHandle = ref<FileSystemFileHandle | null>(null)
const followEnabled = ref(orchStore.settings.scriptFollow)
let followStop: (() => void) | null = null

const running = ref(false)
const runningSeconds = ref(0)
const fileChangedWhileRunning = ref(false)
const externalUpdate = ref(false)
let runHandle: ScriptRunHandle | null = null
let runningTimer: ReturnType<typeof setInterval> | null = null

const hasContent = computed(() => Boolean(fileName.value || fileContent.value))
const dirty = computed(() => fileContent.value !== lastSynced.value)
const fileLanguageLabel = computed(() => fileLanguage.value === 'javascript' ? 'JavaScript' : 'Python')

function detectLanguage(name: string): ScriptLanguage {
  return name.toLowerCase().endsWith('.py') ? 'python' : 'javascript'
}

function formatTime(t: number): string {
  if (!t) return '--'
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

// ─── Monaco（可编辑）────────────────────────────────

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let resizeObserver: ResizeObserver | null = null
let syncing = false

function initEditor() {
  if (!editorContainer.value || editor) return
  monaco.editor.defineTheme('orch-dark', {
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
  editor = monaco.editor.create(editorContainer.value, {
    value: fileContent.value,
    language: fileLanguage.value,
    theme: 'orch-dark',
    automaticLayout: false,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 13,
    lineHeight: 21,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 4,
    insertSpaces: true,
    wordWrap: 'on',
    readOnly: false,
    padding: { top: 12, bottom: 12 },
  })
  editor.onDidChangeModelContent(() => {
    if (syncing || !editor) return
    fileContent.value = editor.getValue()
  })
  // Ctrl+S / Cmd+S：保存（真实模式写回服务端）
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (isMock) {
      toastRef.value?.info('mock 模式无服务端，无需保存')
      return
    }
    if (dirty.value) void saveFile()
  })
  resizeObserver = new ResizeObserver(() => editor?.layout())
  resizeObserver.observe(editorContainer.value)
}

function syncEditor() {
  nextTick(() => {
    initEditor()
    if (!editor) return
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, fileLanguage.value)
    if (editor.getValue() !== fileContent.value) {
      syncing = true
      editor.setValue(fileContent.value)
      syncing = false
    }
    editor.layout()
  })
}

watch([fileContent, fileLanguage], syncEditor)

// ─── 外部更新处理：有修改 → 横幅提示忽略重载；无修改 → 静默刷新 ──

function applyExternalContent(content: string, modified: number, source: string) {
  fileContent.value = content
  fileSize.value = content.length
  lastModified.value = modified
  lastSynced.value = content
  if (running.value) fileChangedWhileRunning.value = true
  addLog('脚本', 'system', `文件已更新并刷新（${source}，${new Date(modified).toLocaleTimeString()}）`)
}

function handleExternalChange(getLatest: () => Promise<string | null>) {
  if (!dirty.value) {
    void getLatest().then(content => {
      if (content !== null) applyExternalContent(content, Date.now(), isMock ? '本地' : '服务端')
    })
    return
  }
  externalUpdate.value = true
}

function discardAndReload() {
  externalUpdate.value = false
  void reloadFile()
}

// ─── 真实模式：服务端脚本文件 ─────────────────────────

async function refreshFileList() {
  loadingFiles.value = true
  try {
    const res = await orchListScripts()
    if (res.success && res.data) {
      fileList.value = res.data
      addLog('脚本', 'system', `服务端脚本列表已刷新（${res.data.length} 个）`)
    } else {
      addLog('脚本', 'error', `获取脚本列表失败：${res.error?.message}`)
    }
  } finally {
    loadingFiles.value = false
  }
}

async function loadServerFile(name: string) {
  const res = await orchGetScript(name)
  if (!res.success || !res.data) {
    toastRef.value?.error(`读取脚本失败：${res.error?.message}`)
    return
  }
  const { content, mtime } = res.data
  fileLanguage.value = detectLanguage(name)
  fileContent.value = content
  lastSynced.value = content
  fileSize.value = content.length
  lastModified.value = mtime
  serverMtime.value = mtime
  externalUpdate.value = false
  fileChangedWhileRunning.value = false
  addLog('脚本', 'system', `已从服务端加载 ${name}`)
}

function onServerFileSelect() {
  if (!fileName.value) {
    fileContent.value = ''
    lastSynced.value = ''
    return
  }
  void loadServerFile(fileName.value)
}

/** 在服务端用 VSCode 打开当前脚本目录 */
async function openInEditor() {
  if (openingEditor.value) return
  openingEditor.value = true
  try {
    const res = await orchOpenScriptsInEditor()
    if (res.success) {
      toastRef.value?.success(`已在服务端用 VSCode 打开 ${res.data?.dir ?? '脚本目录'}`)
    } else {
      toastRef.value?.error(`打开失败：${res.error?.message}`)
    }
  } finally {
    openingEditor.value = false
  }
}

async function saveFile() {
  if (!fileName.value || !dirty.value || saving.value) return
  saving.value = true
  try {
    const res = await orchSaveScript(fileName.value, fileContent.value)
    if (res.success) {
      lastSynced.value = fileContent.value
      fileSize.value = fileContent.value.length
      if (res.data?.mtime) serverMtime.value = res.data.mtime
      suppressUntil = Date.now() + 1500
      externalUpdate.value = false
      addLog('脚本', 'system', `已保存到服务端 ${fileName.value}`)
    } else {
      toastRef.value?.error(`保存失败：${res.error?.message}`)
    }
  } finally {
    saving.value = false
  }
}

// ─── mock 模式：本地文件选择 / 跟随 ──────────────────

async function applyPicked(handle: FileSystemFileHandle | null) {
  if (!handle) return
  fileHandle.value = handle
  fileName.value = handle.name
  fileLanguage.value = detectLanguage(handle.name)
  await reloadFile()
  stopFollow()
  if (followEnabled.value) startFollow()
}

async function pickFile() {
  const picked = await pickScriptFile()
  if (picked) {
    await applyPicked(picked.handle ?? null)
    return
  }
  fileInputRef.value?.click()
}

async function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  fileLanguage.value = detectLanguage(file.name)
  fileContent.value = await file.text()
  lastSynced.value = fileContent.value
  fileSize.value = file.size
  lastModified.value = file.lastModified
  fileHandle.value = null
  stopFollow()
  addLog('脚本', 'system', `已读取文件 ${file.name}（无文件句柄，不支持自动跟随）`)
}

function startFollow() {
  stopFollow()
  if (!fileHandle.value || !followEnabled.value) return
  followStop = watchScriptFile(fileHandle.value, 1500, (content, modified) => {
    if (dirty.value) {
      externalUpdate.value = true
      return
    }
    applyExternalContent(content, modified, '本地')
  })
}

function stopFollow() {
  followStop?.()
  followStop = null
}

function onFollowChange() {
  orchStore.settings.scriptFollow = followEnabled.value
  if (followEnabled.value) startFollow()
  else stopFollow()
}

// ─── 重新读取（忽略当前修改）─────────────────────────

async function reloadFile() {
  if (!fileName.value) return
  if (isMock) {
    if (!fileHandle.value) {
      toastRef.value?.info('mock 模式请使用「选择文件」')
      return
    }
    try {
      const file = await fileHandle.value.getFile()
      const content = await file.text()
      fileContent.value = content
      lastSynced.value = content
      fileSize.value = content.length
      lastModified.value = file.lastModified
      externalUpdate.value = false
      addLog('脚本', 'system', '已重新读取文件（忽略当前修改）')
    } catch (err) {
      toastRef.value?.error(`读取文件失败：${(err as Error).message}`)
    }
    return
  }
  await loadServerFile(fileName.value)
  addLog('脚本', 'system', '已重新读取文件（忽略当前修改）')
}

// ─── 运行控制 ──────────────────────────────────────

async function runScriptAction() {
  if (running.value) return
  if (!fileName.value) {
    toastRef.value?.info('请先选择脚本文件')
    return
  }
  if (fileLanguage.value === 'python' && isMock) {
    toastRef.value?.info('Python 脚本需在真实模式运行（后端 python3 子进程）')
    return
  }
  const code = fileContent.value
  if (!code.trim()) { toastRef.value?.info('脚本内容为空'); return }
  fileChangedWhileRunning.value = false
  running.value = true
  startRunTimer()
  const handle = await runScript(code, { fileName: fileName.value, language: fileLanguage.value }, () => {
    running.value = false
    stopRunTimer()
  })
  runHandle = handle
}

async function rerunScript() {
  stopScript()
  await new Promise(r => setTimeout(r, 50))
  await runScriptAction()
}

function stopScript() {
  if (!running.value && !runHandle) return
  runHandle?.stop()
  runHandle = null
  running.value = false
  stopRunTimer()
  addLog('脚本', 'system', '脚本已终止')
}

function startRunTimer() {
  stopRunTimer()
  runningSeconds.value = 0
  runningTimer = setInterval(() => { runningSeconds.value++ }, 1000)
}

function stopRunTimer() {
  if (runningTimer) { clearInterval(runningTimer); runningTimer = null }
}

// 真实模式：运行状态由后端 WS（orch-event → script-status）驱动
watch(() => orchStore.scriptRunning, (v) => {
  if (isMock) return
  running.value = v
  if (v) startRunTimer()
  else stopRunTimer()
})

// 真实模式：服务端文件变更（fs.watch → WS）
let unsubScriptChange: (() => void) | null = null
let unsubScriptsDir: (() => void) | null = null
if (!isMock) {
  unsubScriptChange = onOrchScriptChange((name, mtime) => {
    if (!fileName.value || name !== fileName.value) return
    if (Date.now() < suppressUntil) return
    if (mtime > 0 && mtime <= serverMtime.value) return
    serverMtime.value = Math.max(serverMtime.value, mtime)
    if (running.value) fileChangedWhileRunning.value = true
    handleExternalChange(async () => {
      const res = await orchGetScript(name)
      return res.success && res.data ? res.data.content : null
    })
  })
  // 服务端脚本目录被修改（通用设置）→ 自动刷新文件列表
  unsubScriptsDir = onOrchScriptsDirChange((dir) => {
    orchStore.settings.scriptsDir = dir
    fileName.value = ''
    fileContent.value = ''
    lastSynced.value = ''
    void refreshFileList()
    addLog('脚本', 'system', `服务端脚本目录已切换为 ${dir}，列表已刷新`)
  })
}

function loadExample() {
  const example = `// 编排脚本示例：设备消息驱动 Docat Motion 取放
// 连接/重连/心跳由编排引擎负责，脚本只处理逻辑。
//
// 自演示流程（前端模拟模式）：
//   1. 添加设备：vision_udp（类型 UDP，IP 127.0.0.1，端口任意）
//                 motion_arm（类型 Docat Motion，选择被模拟设备）
//   2. 打开两者连接开关
//   3. 点「运行」—— 脚本每 5 秒发一帧坐标到 vision_udp（UDP 回环返回）
//      收到后驱动 motion_arm 执行 GP 取放，可在「日志」观察完整收发。

log.info('脚本已启动，等待设备消息…')

// 消息事件：UDP 回环消息当作"视觉坐标下发"
devices.onMessage('vision_udp', async (msg) => {
  const parts = utils.toArray(msg)              // 默认分隔符 ';'
  log.info('收到消息: ' + utils.toString(parts, ','))

  if (parts[0] !== 'OK') return

  const pick  = [Number(parts[1]), Number(parts[2]), 60, 0, 0, 0]
  const place = [300, 50, 60, 0, 0, 0]

  const dockText = poses.get('home_pose', ';') ?? '0;0;0;0;0;0'

  devices.send('motion_arm',
    'GP;' + utils.toString(pick) + ';' + utils.toString(place) + ';' + dockText)

  await utils.sleep(2000)
  log.info('一轮取放完成（详见 motion_arm 日志）')
})

// 模拟视觉触发：每 5 秒发一帧坐标（UDP 设备回环返回）
setInterval(() => {
  if (devices.isConnected('vision_udp')) {
    devices.send('vision_udp', 'OK;120;40')
  }
}, 5000)
`
  fileName.value = '示例脚本.js'
  fileLanguage.value = 'javascript'
  fileContent.value = example
  lastSynced.value = example
  fileSize.value = example.length
  lastModified.value = Date.now()
  fileHandle.value = null
  stopFollow()
  externalUpdate.value = false
  addLog('脚本', 'system', '已载入示例脚本（按「运行」体验）')
}

onMounted(() => {
  initEditor()
  if (!isMock) void refreshFileList()
})

onBeforeUnmount(() => {
  stopScript()
  stopFollow()
  unsubScriptChange?.()
  unsubScriptChange = null
  unsubScriptsDir?.()
  unsubScriptsDir = null
  resizeObserver?.disconnect()
  editor?.dispose()
  editor = null
})
</script>

<style scoped>
.script-panel { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.script-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.toolbar-sep { width: 1px; height: 18px; background: var(--border-bright); margin: 0 4px; }
.file-select {
  min-width: 180px; padding: 5px 8px; font-family: var(--font-mono); font-size: 0.68rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.file-select:focus { border-color: var(--accent); }

.follow-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.follow-toggle input { display: none; }
.follow-track {
  position: relative; width: 36px; height: 20px; border-radius: 10px;
  background: var(--surface-2); border: 1px solid var(--border); transition: all var(--duration-fast); flex-shrink: 0;
}
.follow-thumb {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--text-muted); transition: all var(--duration-fast) var(--ease-out);
}
.follow-toggle input:checked + .follow-track { background: var(--cyan-900); border-color: var(--cyan-500); }
.follow-toggle input:checked + .follow-track .follow-thumb { left: 18px; background: var(--cyan-300); }
.follow-toggle input:disabled + .follow-track { opacity: 0.4; }
.follow-text { font-family: var(--font-body); font-size: 0.66rem; font-weight: 500; color: var(--text-secondary); }

.file-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 7px 10px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); }
.file-name { font-family: var(--font-mono); font-size: 0.7rem; font-weight: 600; color: var(--text-primary); }
.file-meta { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); }
.dirty-badge { font-family: var(--font-mono); font-size: 0.6rem; font-weight: 600; color: var(--status-warning); }
.run-badge { font-family: var(--font-mono); font-size: 0.62rem; font-weight: 600; color: var(--status-online); margin-left: auto; }
.run-badge--warn { color: var(--status-warning); }

.update-banner {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px; background: var(--status-warning-dim);
  border: 1px solid var(--status-warning); border-radius: var(--radius);
  font-size: 0.68rem; color: var(--amber-300);
}
.update-banner span { flex: 1; }
.btn-xs { padding: 3px 8px; font-size: 10px; }

.script-editor {
  flex: 1; min-height: 240px; overflow: hidden;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  outline: none;
}
.script-editor:focus-within { border-color: var(--accent); }

.script-hint { display: flex; gap: 4px 10px; flex-wrap: wrap; font-size: 0.6rem; color: var(--text-muted); }
.script-hint code {
  font-family: var(--font-mono); font-size: 0.6rem; color: var(--cyan-300);
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px;
}
</style>
