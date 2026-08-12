/**
 * monaco-editor 语言定义深层模块的类型声明
 * （包内 exports 未暴露这些路径的 .d.ts，这里补充最小类型）
 */
declare module 'monaco-editor/languages/definitions/javascript/javascript' {
  import type { languages } from 'monaco-editor'
  export const conf: languages.LanguageConfiguration
  export const language: languages.IMonarchLanguage
}

declare module 'monaco-editor/languages/definitions/python/python' {
  import type { languages } from 'monaco-editor'
  export const conf: languages.LanguageConfiguration
  export const language: languages.IMonarchLanguage
}
