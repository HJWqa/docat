import { reactive } from 'vue'
import type { Script, ScriptLanguage } from 'docat-shared/types'

export interface ScriptDraft {
  name: string
  content: string
  language: Extract<ScriptLanguage, 'lua' | 'python'>
  deviceId: string
  projectName: string
}

export const scriptStore = reactive({
  scripts: [] as Script[],
  loaded: false,
  selectedScriptId: '',
  drafts: {} as Record<string, ScriptDraft>,

  setScripts(scripts: Script[]) {
    this.scripts = scripts
    this.loaded = true
  },

  upsert(script: Script) {
    const index = this.scripts.findIndex(item => item.id === script.id)
    if (index >= 0) this.scripts.splice(index, 1, script)
    else this.scripts.unshift(script)
    this.loaded = true
  },

  remove(id: string) {
    this.scripts = this.scripts.filter(script => script.id !== id)
    delete this.drafts[id]
    if (this.selectedScriptId === id) this.selectedScriptId = ''
  },

  setSelected(id: string) {
    this.selectedScriptId = id
  },

  setDraft(id: string, draft: ScriptDraft) {
    this.drafts[id] = { ...draft }
    this.selectedScriptId = id
  },

  getDraft(id: string): ScriptDraft | null {
    return this.drafts[id] ?? null
  },

  reset() {
    this.scripts = []
    this.loaded = false
    this.selectedScriptId = ''
    this.drafts = {}
  },
})
