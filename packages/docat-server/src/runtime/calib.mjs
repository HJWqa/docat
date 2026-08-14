/**
 * 标定转换核心（JS）— 供脚本运行时 utils.calib 使用
 *
 * 支持两种标定文件：
 *  - .iwcal：36 字节 = 9 个 float32（小端），3×3 仿射矩阵（行主序，末行 0 0 1）
 *  - .xml：<CalibMatrix> 内 9 个 <ParamValue>，结构同 iwcal
 *
 * 矩阵方向：图像坐标 → 物理（世界）坐标（与「标定辅助」一致）
 *   wx = m00*ix + m01*iy + m02
 *   wy = m10*ix + m11*iy + m12
 * worldToImage 通过 2×2 矩阵求逆实现。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 解析 .iwcal：9 个 float32（小端）
 * @param {string} path 文件路径
 * @param {string} [baseDir] 相对路径基准（脚本目录）
 * @returns {{m00:number,m01:number,m02:number,m10:number,m11:number,m12:number}}
 */
export function parseIwcaf(path, baseDir) {
  const buf = readCalibFile(path, baseDir)
  if (buf.length < 36) throw new Error(`iwcal 文件过小（${buf.length}B，应为 36B）`)
  const v = []
  for (let i = 0; i < 9; i++) v.push(buf.readFloatLE(i * 4))
  return matrixFromArray(v)
}

/**
 * 解析 .xml 标定文件
 * @param {string} path 文件路径
 * @param {string} [baseDir] 相对路径基准（脚本目录）
 * @returns {{m00:number,m01:number,m02:number,m10:number,m11:number,m12:number,precision?:number}}
 */
export function parseXml(path, baseDir) {
  const text = readCalibFile(path, baseDir).toString('utf-8')
  return parseXmlText(text)
}

/**
 * 读取标定文件：原路径失败（ENOENT）时自动做 WSL⇄Windows 路径转换后再试一次。
 * @param {string} path
 * @param {string} [baseDir]
 * @returns {Buffer}
 */
function readCalibFile(path, baseDir) {
  const p = resolvePath(path, baseDir)
  try {
    return readFileSync(p)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    const converted = convertPath(p)
    if (!converted || converted === p) throw err
    try {
      return readFileSync(converted)
    } catch (err2) {
      if (err2.code !== 'ENOENT') throw err2
      throw new Error(`标定文件不存在：${p}（已尝试转换路径：${converted}）`)
    }
  }
}

/** WSL ⇄ Windows 路径互转（不匹配返回 null） */
function convertPath(path) {
  const wsl = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(path)
  if (wsl) return `${wsl[1].toUpperCase()}:${(wsl[2] || '').replace(/\//g, '\\') || '\\'}`
  const win = /^([a-zA-Z]):[\\/](.*)$/.exec(path)
  if (win) return `/mnt/${win[1].toLowerCase()}/${(win[2] || '').replace(/[\\/]/g, '/')}`
  return null
}

/**
 * 解析 .xml 文本（供前端/测试复用）
 * @param {string} text xml 内容
 */
export function parseXmlText(text) {
  // 轻量解析：取 CalibMatrix 段，提取其中的数值
  const segMatch = /<CalibFloatListParam[^>]*ParamName="CalibMatrix"[^>]*>([\s\S]*?)<\/CalibFloatListParam>/.exec(text)
  const seg = segMatch ? segMatch[1] : text
  const values = []
  const re = /<ParamValue>\s*([-+0-9.eE]+)\s*<\/ParamValue>/g
  let m
  while ((m = re.exec(seg))) {
    const n = Number(m[1])
    if (Number.isFinite(n)) values.push(n)
  }
  if (values.length < 9) throw new Error('xml 中未找到有效的 CalibMatrix（需 9 个数值）')

  let precision
  const pm = /<CalibParam[^>]*ParamName="PixelPrecision"[^>]*>\s*<ParamValue>\s*([-+0-9.eE]+)\s*<\/ParamValue>/.exec(text)
  if (pm) {
    const p = Number(pm[1])
    if (Number.isFinite(p) && p > 0) precision = p
  }
  return Object.assign(matrixFromArray(values.slice(0, 9)), precision !== undefined ? { precision } : {})
}

function matrixFromArray(v) {
  return { m00: v[0], m01: v[1], m02: v[2], m10: v[3], m11: v[4], m12: v[5] }
}

function resolvePath(path, baseDir) {
  const p = String(path)
  if (!baseDir || p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return p
  return join(baseDir, p)
}

/**
 * 图像坐标 → 物理坐标；sep 给定时返回文本
 * @param {{m00:number,m01:number,m02:number,m10:number,m11:number,m12:number}} m
 */
export function imageToWorld(m, x, y, sep) {
  const wx = m.m00 * x + m.m01 * y + m.m02
  const wy = m.m10 * x + m.m11 * y + m.m12
  return sep !== undefined && sep !== null ? `${fmtNumber(wx)}${sep}${fmtNumber(wy)}` : [wx, wy]
}

/**
 * 物理坐标 → 图像坐标（2×2 矩阵求逆）；sep 给定时返回文本
 * @param {{m00:number,m01:number,m02:number,m10:number,m11:number,m12:number}} m
 */
export function worldToImage(m, wx, wy, sep) {
  const det = m.m00 * m.m11 - m.m01 * m.m10
  if (Math.abs(det) < 1e-12) throw new Error('标定矩阵不可逆（行列式接近 0）')
  const ix = (m.m11 * (wx - m.m02) - m.m01 * (wy - m.m12)) / det
  const iy = (-m.m10 * (wx - m.m02) + m.m00 * (wy - m.m12)) / det
  return sep !== undefined && sep !== null ? `${fmtNumber(ix)}${sep}${fmtNumber(iy)}` : [ix, iy]
}

/** 浮点数固定 6 位小数（去尾零），避免科学计数法；非 number 原样字符串化 */
function fmtNumber(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v)
  const s = v.toFixed(6).replace(/\.?0+$/, '')
  return s === '' || s === '-0' ? '0' : s
}
