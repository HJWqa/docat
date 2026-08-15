/**
 * Python 标准库补全数据 — 服务端快照优先，localStorage 缓存，离线/失败回退内置表。
 *
 * 两个编辑器视图（编排脚本面板 / 编程视图）共用，保证 mock 模式与真实模式
 * 都能补全 builtins（enumerate/len/range...）、类型方法（split/join...）与
 * 常用 stdlib 模块成员（math/log2 等）。
 */
import * as monaco from 'monaco-editor/editor/editor.api.js'
import { orchListPythonStdlibSnapshot, type OrchStdlibMember } from '../services/orchApi'

export type StdlibMember = OrchStdlibMember

export interface PythonStdlibSnapshot {
  builtins: StdlibMember[]
  types: Record<string, StdlibMember[]>
  modules: Record<string, StdlibMember[]>
}

const CACHE_KEY = 'docat.orchestration.python-stdlib-snapshot.v1'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

let memoryCache: PythonStdlibSnapshot | null = null
let inflight: Promise<PythonStdlibSnapshot> | null = null

function member(name: string, type: 'function' | 'variable', doc = ''): StdlibMember {
  return { name, type, doc }
}

/** 常用类型方法（服务端快照不可用时兜底） */
const FALLBACK_TYPES: Record<string, StdlibMember[]> = {
  str: [
    'capitalize', 'casefold', 'center', 'count', 'encode', 'endswith', 'expandtabs', 'find', 'format', 'format_map',
    'index', 'isalnum', 'isalpha', 'isascii', 'isdecimal', 'isdigit', 'isidentifier', 'islower', 'isnumeric',
    'isprintable', 'isspace', 'istitle', 'isupper', 'join', 'ljust', 'lower', 'lstrip', 'maketrans', 'partition',
    'removeprefix', 'removesuffix', 'replace', 'rfind', 'rindex', 'rjust', 'rpartition', 'rsplit', 'rstrip',
    'split', 'splitlines', 'startswith', 'strip', 'swapcase', 'title', 'translate', 'upper', 'zfill',
  ].map(name => member(name, 'function')),
  list: ['append', 'clear', 'copy', 'count', 'extend', 'index', 'insert', 'pop', 'remove', 'reverse', 'sort']
    .map(name => member(name, 'function')),
  dict: ['clear', 'copy', 'fromkeys', 'get', 'items', 'keys', 'pop', 'popitem', 'setdefault', 'update', 'values']
    .map(name => member(name, 'function')),
  set: [
    'add', 'clear', 'copy', 'difference', 'difference_update', 'discard', 'intersection', 'intersection_update',
    'isdisjoint', 'issubset', 'issuperset', 'pop', 'remove', 'symmetric_difference', 'symmetric_difference_update',
    'union', 'update',
  ].map(name => member(name, 'function')),
  tuple: ['count', 'index'].map(name => member(name, 'function')),
  bytes: [
    'center', 'count', 'decode', 'endswith', 'find', 'fromhex', 'hex', 'index', 'isalnum', 'isalpha', 'isascii',
    'isdigit', 'islower', 'isspace', 'istitle', 'isupper', 'join', 'ljust', 'lower', 'lstrip', 'partition',
    'removeprefix', 'removesuffix', 'replace', 'rfind', 'rindex', 'rjust', 'rpartition', 'rsplit', 'rstrip',
    'split', 'splitlines', 'startswith', 'strip', 'swapcase', 'title', 'translate', 'upper', 'zfill',
  ].map(name => member(name, 'function')),
}

/** math 等常用 stdlib 模块成员（服务端快照不可用时兜底） */
const FALLBACK_MODULES: Record<string, StdlibMember[]> = {
  math: [
    'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt', 'ceil', 'comb', 'copysign', 'cos', 'cosh',
    'degrees', 'dist', 'erf', 'erfc', 'exp', 'expm1', 'fabs', 'factorial', 'floor', 'fmod', 'frexp', 'fsum',
    'gamma', 'gcd', 'hypot', 'isclose', 'isfinite', 'isinf', 'isnan', 'isqrt', 'lcm', 'ldexp', 'lgamma', 'log',
    'log10', 'log1p', 'log2', 'modf', 'perm', 'pow', 'prod', 'radians', 'remainder', 'sin', 'sinh', 'sqrt', 'tan',
    'tanh', 'trunc', 'ulp',
  ].map(name => member(name, 'function')).concat([
    member('e', 'variable', '自然常数 ≈ 2.71828'),
    member('inf', 'variable', '正无穷'),
    member('nan', 'variable', 'NaN'),
    member('pi', 'variable', '圆周率 ≈ 3.14159'),
    member('tau', 'variable', '周长比率 ≈ 6.28318'),
  ]),
  json: ['dump', 'dumps', 'load', 'loads'].map(name => member(name, 'function')),
  random: ['choice', 'choices', 'randint', 'random', 'sample', 'seed', 'shuffle', 'uniform']
    .map(name => member(name, 'function')),
  re: ['compile', 'findall', 'finditer', 'fullmatch', 'match', 'search', 'split', 'sub']
    .map(name => member(name, 'function')),
  time: ['localtime', 'monotonic', 'perf_counter', 'sleep', 'strftime', 'time'].map(name => member(name, 'function')),
  os: ['getcwd', 'listdir', 'makedirs', 'path', 'remove', 'rename', 'rmdir', 'system', 'walk']
    .map(name => member(name, name === 'path' ? 'variable' : 'function')),
}

/** Python 内置函数/类型（服务端快照不可用时兜底；3.11 全量公共内置） */
const FALLBACK_BUILTINS: StdlibMember[] = [
  'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray', 'bytes', 'callable',
  'chr', 'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec',
  'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input',
  'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next',
  'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
  'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip',
].map(name => member(name, 'function')).concat([
  member('None', 'variable', '空值（singleton）'),
  member('False', 'variable', '布尔假'),
  member('True', 'variable', '布尔真'),
])

/** 内置兜底快照（服务端/mock 离线时保证补全完整） */
const FALLBACK_SNAPSHOT: PythonStdlibSnapshot = {
  builtins: FALLBACK_BUILTINS,
  types: FALLBACK_TYPES,
  modules: FALLBACK_MODULES,
}

/** 编排脚本面板用 Python 关键字（与 monarch python 定义一致） */
export const PYTHON_KEYWORDS: string[] = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'match',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]

function isFresh(parsed: { savedAt: number }): boolean {
  return typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt < CACHE_TTL
}

function readCache(): PythonStdlibSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt: number; snapshot: PythonStdlibSnapshot }
    if (!isFresh(parsed) || !parsed.snapshot?.builtins) return null
    return parsed.snapshot
  } catch {
    return null
  }
}

function writeCache(snapshot: PythonStdlibSnapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), snapshot }))
  } catch {
    // localStorage 不可用（隐私模式/配额）时忽略，仅内存缓存
  }
}

/**
 * 加载 Python 标准库快照（幂等，并发安全）：
 * 内存缓存 → localStorage（7 天 TTL）→ 服务端生成 → 内置兜底表。
 * 任何情况下都不抛错、都返回完整数据。
 */
export function loadPythonSnapshot(): Promise<PythonStdlibSnapshot> {
  if (memoryCache) return Promise.resolve(memoryCache)
  if (inflight) return inflight
  const cached = readCache()
  if (cached) {
    memoryCache = cached
    return Promise.resolve(cached)
  }
  inflight = orchListPythonStdlibSnapshot()
    .then(res => {
      const snapshot = res.success && res.data && Array.isArray(res.data.builtins) ? res.data as PythonStdlibSnapshot : null
      if (snapshot) {
        memoryCache = snapshot
        writeCache(snapshot)
      }
      return snapshot ?? FALLBACK_SNAPSHOT
    })
    .catch(() => FALLBACK_SNAPSHOT)
    .finally(() => { inflight = null })
  return inflight
}

/** 取当前快照（可能为 null：尚未加载完成时调用方跳过该部分补全） */
export function getPythonSnapshotOrFallback(): PythonStdlibSnapshot {
  return memoryCache ?? FALLBACK_SNAPSHOT
}

function toItems(members: StdlibMember[], detail: string, range: monaco.Range, sortPrefix: string): monaco.languages.CompletionItem[] {
  return members.map(m => ({
    label: m.name,
    kind: m.type === 'function'
      ? monaco.languages.CompletionItemKind.Function
      : monaco.languages.CompletionItemKind.Variable,
    detail,
    documentation: m.doc || undefined,
    insertText: m.type === 'function' ? `${m.name}(` : m.name,
    sortText: `${sortPrefix}_${m.name}`,
    range,
  }))
}

/** builtins 补全（裸标识符即可命中，如 enumerate(） */
export function builtinItems(snapshot: PythonStdlibSnapshot, range: monaco.Range): monaco.languages.CompletionItem[] {
  return toItems(snapshot.builtins, 'Python 内置', range, '3000')
}

/** 类型方法补全（`xxx.` 后命中，如 s.split(）；返回所有常用类型的方法合集 */
export function typeMethodItems(snapshot: PythonStdlibSnapshot, range: monaco.Range): monaco.languages.CompletionItem[] {
  const items: monaco.languages.CompletionItem[] = []
  const seen = new Set<string>()
  for (const typeName of ['str', 'list', 'dict', 'set', 'tuple', 'bytes']) {
    const members = snapshot.types[typeName]
    if (!members) continue
    for (const m of members) {
      if (seen.has(m.name)) continue
      seen.add(m.name)
      items.push({
        label: m.name,
        kind: monaco.languages.CompletionItemKind.Method,
        detail: `${typeName} 方法`,
        documentation: m.doc || undefined,
        insertText: m.type === 'function' ? `${m.name}(` : m.name,
        sortText: `2500_${m.name}`,
        range,
      })
    }
  }
  return items
}

/** 已导入模块成员（import math 后 math. 零延迟命中；未收录则返回空） */
export function moduleMemberItems(snapshot: PythonStdlibSnapshot, moduleName: string, range: monaco.Range): monaco.languages.CompletionItem[] {
  const members = snapshot.modules[moduleName]
  return members ? toItems(members, `${moduleName} 模块`, range, '0000') : []
}
