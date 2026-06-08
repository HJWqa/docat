import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const DEFAULT_INDEX_URL = 'http://10.124.9.91:3344/6Axis/zh/search_plus_index.json'
const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = resolve(__dirname, '../src/services/dobotApiCatalog.ts')

const apiPages = [
  'Motion',
  'Motion Relative',
  'Motion Params',
  'IO',
  'Tool',
  'TCP&UDP',
  'Modbus',
  'Bus',
  'Program Manage',
  'Program Trap',
  'Tray',
  'Safety Skin',
]

function fetchText(url) {
  return new Promise((resolveText, reject) => {
    http.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`GET ${url} failed: ${response.statusCode}`))
        response.resume()
        return
      }
      response.setEncoding('utf8')
      let data = ''
      response.on('data', chunk => { data += chunk })
      response.on('end', () => resolveText(data))
    }).on('error', reject)
  })
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/，/g, ',')
    .trim()
}

function categoryFromTitle(title) {
  return cleanText(title).replace(/^[CE]\.\d+\s*/, '')
}

function splitTopLevelArgs(args) {
  const parts = []
  let current = ''
  let depth = 0
  let quote = ''
  for (const char of args) {
    if (quote) {
      current += char
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function firstCall(prototype, label) {
  const normalized = cleanText(prototype)
  const start = normalized.indexOf(`${label}(`)
  if (start < 0) return `${label}()`
  let depth = 0
  let quote = ''
  for (let index = start + label.length; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return normalized.slice(start, index + 1)
    }
  }
  return normalized.slice(start)
}

function snippetFromPrototype(label, prototype) {
  const call = firstCall(prototype, label)
  const open = call.indexOf('(')
  const close = call.lastIndexOf(')')
  if (open < 0 || close < open) return `${label}()`
  const args = splitTopLevelArgs(call.slice(open + 1, close))
  if (!args.length) return `${label}()`
  return `${label}(${args.map((arg, index) => `\${${index + 1}:${arg}}`).join(', ')})`
}

function extractDescription(section) {
  const match = /描述[：:]?\s+([\s\S]*?)(?=\s+(?:必选参数|可选参数|参数|返回|示例|说明：|注意：|[A-Z][A-Za-z0-9_]*\s+原型[：:]?))/u.exec(section)
  return cleanText(match?.[1] || '')
}

function extractCommands(pageKey, page, language) {
  const body = cleanText(page.body)
  const category = categoryFromTitle(page.title)
  const commandPattern = /\b([A-Z][A-Za-z0-9_]*)\s+原型[：:]?\s+([\s\S]*?)(?=\s+描述[：:]?)/gu
  const matches = [...body.matchAll(commandPattern)]
  const commands = []
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const label = match[1]
    const prototype = cleanText(match[2])
    const nextIndex = matches[index + 1]?.index ?? body.length
    const section = body.slice(match.index, nextIndex)
    const description = extractDescription(section)
    const detail = description ? `${category} - ${description}` : category
    commands.push({
      label,
      language,
      category,
      prototype,
      insertText: snippetFromPrototype(label, prototype),
      detail: detail.slice(0, 220),
      documentation: [
        `**${label}**`,
        '',
        `分类：${category}`,
        '',
        `原型：\`${prototype}\``,
        description ? `\n${description}` : '',
      ].join('\n').trim(),
      aliases: `${category} ${description} ${prototype}`,
      source: pageKey,
    })
  }
  return commands
}

function buildCatalog(index) {
  const catalog = { lua: [], python: [] }
  for (const language of ['lua', 'python']) {
    const prefix = language === 'lua' ? 'script' : 'python'
    const seen = new Set()
    for (const pageName of apiPages) {
      const pageKey = `${prefix}/${pageName}.html`
      const page = index[pageKey]
      if (!page) continue
      for (const command of extractCommands(pageKey, page, language)) {
        if (seen.has(command.label)) continue
        seen.add(command.label)
        catalog[language].push(command)
      }
    }
  }
  return catalog
}

function renderCatalog(catalog) {
  return `// Generated by scripts/generate-dobot-api-catalog.mjs. Do not edit by hand.
export interface DobotApiCompletion {
  label: string
  language: 'lua' | 'python'
  category: string
  prototype: string
  insertText: string
  detail: string
  documentation: string
  aliases: string
  source: string
}

export const DOBOT_API_CATALOG: Record<'lua' | 'python', DobotApiCompletion[]> = ${JSON.stringify(catalog, null, 2)}
`
}

const input = process.argv[2]
const indexText = input
  ? readFileSync(input, 'utf8')
  : await fetchText(process.env.DOBOT_MANUAL_INDEX_URL || DEFAULT_INDEX_URL)
const catalog = buildCatalog(JSON.parse(indexText))
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, renderCatalog(catalog))
console.log(`Generated ${outputPath}`)
console.log(`Lua commands: ${catalog.lua.length}`)
console.log(`Python commands: ${catalog.python.length}`)
