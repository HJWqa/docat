export type CalibModel = 'affine' | 'homography'
export type WeightFn = 'lsq' | 'huber' | 'tukey' | 'ransac'

export interface CalibPoint {
  imgX: number
  imgY: number
  physX: number
  physY: number
  angle: number
}

export interface CalibOptions {
  ransacThreshold?: number
}

export interface CalibResult {
  model: CalibModel
  coefs: number[]
  residuals: number[]
  rmse: number
  inlierCount: number
  pointCount: number
  usable: boolean
}

const MIN_POINTS: Record<CalibModel, number> = { affine: 3, homography: 4 }
const RANSAC_SAMPLE: Record<CalibModel, number> = { affine: 3, homography: 4 }

function gaussSolve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('singular')
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    const pv = M[col][col]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / pv
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

function solveLeastSquares(rows: number[][], rhs: number[], n: number): number[] {
  const N: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const v: number[] = new Array(n).fill(0)
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < n; a++) {
      v[a] += rows[i][a] * rhs[i]
      for (let b = 0; b < n; b++) N[a][b] += rows[i][a] * rows[i][b]
    }
  }
  return gaussSolve(N, v)
}

function fitAffine(points: CalibPoint[], weights: number[]): number[] {
  let rows: number[][] = []
  let rhs: number[] = []
  for (let i = 0; i < points.length; i++) {
    const s = Math.sqrt(weights[i])
    rows.push([s, s * points[i].imgX, s * points[i].imgY])
    rhs.push(s * points[i].physX)
  }
  const a = solveLeastSquares(rows, rhs, 3)
  rows = []
  rhs = []
  for (let i = 0; i < points.length; i++) {
    const s = Math.sqrt(weights[i])
    rows.push([s, s * points[i].imgX, s * points[i].imgY])
    rhs.push(s * points[i].physY)
  }
  const b = solveLeastSquares(rows, rhs, 3)
  return [...a, ...b]
}

function fitHomography(points: CalibPoint[], weights: number[]): number[] {
  const rows: number[][] = []
  const rhs: number[] = []
  for (let i = 0; i < points.length; i++) {
    const s = Math.sqrt(weights[i])
    const x = points[i].imgX
    const y = points[i].imgY
    const px = points[i].physX
    const py = points[i].physY
    rows.push([s * x, s * y, s, 0, 0, 0, -s * x * px, -s * y * px])
    rhs.push(s * px)
    rows.push([0, 0, 0, s * x, s * y, s, -s * x * py, -s * y * py])
    rhs.push(s * py)
  }
  return solveLeastSquares(rows, rhs, 8)
}

function fitModel(points: CalibPoint[], model: CalibModel, weights: number[]): number[] {
  return model === 'affine' ? fitAffine(points, weights) : fitHomography(points, weights)
}

function computeResiduals(coefs: number[], model: CalibModel, points: CalibPoint[]): number[] {
  return points.map(p => {
    let px: number
    let py: number
    if (model === 'affine') {
      px = coefs[0] + coefs[1] * p.imgX + coefs[2] * p.imgY
      py = coefs[3] + coefs[4] * p.imgX + coefs[5] * p.imgY
    } else {
      const den = coefs[6] * p.imgX + coefs[7] * p.imgY + 1
      px = (coefs[0] * p.imgX + coefs[1] * p.imgY + coefs[2]) / den
      py = (coefs[3] * p.imgX + coefs[4] * p.imgY + coefs[5]) / den
    }
    return Math.hypot(px - p.physX, py - p.physY)
  })
}

function madSigma(res: number[]): number {
  const sorted = [...res].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]
  const dev = sorted.map(r => Math.abs(r - med)).sort((a, b) => a - b)
  return 1.4826 * dev[Math.floor(dev.length / 2)]
}

/** Huber / Tukey 迭代加权最小二乘（IRLS） */
function fitRobust(points: CalibPoint[], model: CalibModel, weightFn: WeightFn): { coefs: number[]; weights: number[] } {
  let w = points.map(() => 1)
  let coefs = fitModel(points, model, w)
  let res = computeResiduals(coefs, model, points)
  for (let iter = 0; iter < 40; iter++) {
    const sigma = madSigma(res) || 0.001
    const c = weightFn === 'huber' ? 1.345 * sigma : 4.685 * sigma
    const nw = points.map((_, i) => {
      const r = res[i]
      if (weightFn === 'huber') return Math.abs(r) <= c ? 1 : c / Math.abs(r)
      return Math.abs(r) <= c ? Math.pow(1 - (r / c) * (r / c), 2) : 0
    })
    if (nw.every(x => x <= 1e-12)) {
      nw.forEach((_, i) => { nw[i] = 1 })
    }
    const nCoefs = fitModel(points, model, nw)
    const nRes = computeResiduals(nCoefs, model, points)
    const maxDelta = Math.max(...coefs.map((v, k) => Math.abs(v - nCoefs[k])))
    coefs = nCoefs
    res = nRes
    w = nw
    if (maxDelta < 1e-10) break
  }
  return { coefs, weights: w }
}

function fitRansac(points: CalibPoint[], model: CalibModel, threshold: number): { coefs: number[]; inliers: boolean[] } {
  const n = points.length
  const m = RANSAC_SAMPLE[model]
  const allIn = points.map(() => true)
  if (n < m) return { coefs: fitModel(points, model, points.map(() => 1)), inliers: allIn }
  const pConf = 0.99
  let maxIter = 500
  let bestCoefs: number[] | null = null
  let bestInliers: boolean[] = []
  let bestCount = 0
  let i = 0
  while (i < maxIter) {
    const idx = new Set<number>()
    let guard = 0
    while (idx.size < m && guard++ < n * 2) idx.add(Math.floor(Math.random() * n))
    if (idx.size < m) { i++; continue }
    const sample = [...idx].map(k => points[k])
    let c: number[]
    try {
      c = fitModel(sample, model, sample.map(() => 1))
    } catch {
      i++
      continue
    }
    const res = computeResiduals(c, model, points)
    const inliers = res.map(r => r <= threshold)
    const count = inliers.filter(Boolean).length
    if (count > bestCount) {
      bestCount = count
      bestCoefs = c
      bestInliers = inliers
      const ratio = count / n
      if (ratio > 0) {
        maxIter = Math.min(maxIter, Math.ceil(Math.log(1 - pConf) / Math.log(1 - Math.pow(ratio, m))))
      }
    }
    i++
  }
  if (!bestCoefs || bestCount < m) {
    return { coefs: fitModel(points, model, points.map(() => 1)), inliers: allIn }
  }
  const inPts = points.filter((_, k) => bestInliers[k])
  let coefs: number[]
  try {
    coefs = fitModel(inPts, model, inPts.map(() => 1))
  } catch {
    coefs = bestCoefs
  }
  return { coefs, inliers: bestInliers }
}

export function fitCalibration(points: CalibPoint[], model: CalibModel, weightFn: WeightFn, options: CalibOptions = {}): CalibResult {
  const n = points.length
  const threshold = options.ransacThreshold ?? 1
  if (n < MIN_POINTS[model]) {
    return { model, coefs: [], residuals: [], rmse: Infinity, inlierCount: 0, pointCount: n, usable: false }
  }
  let coefs: number[] | null = null
  let inliers: boolean[] = points.map(() => true)
  try {
    if (weightFn === 'ransac') {
      const r = fitRansac(points, model, threshold)
      coefs = r.coefs
      inliers = r.inliers
    } else if (weightFn === 'lsq') {
      coefs = fitModel(points, model, points.map(() => 1))
    } else {
      const r = fitRobust(points, model, weightFn)
      coefs = r.coefs
      inliers = r.weights.map(w => w > 0)
    }
  } catch {
    try {
      coefs = fitModel(points, model, points.map(() => 1))
      inliers = points.map(() => true)
    } catch {
      coefs = null
    }
  }
  if (!coefs) {
    return { model, coefs: [], residuals: [], rmse: Infinity, inlierCount: 0, pointCount: n, usable: false }
  }
  const residuals = computeResiduals(coefs, model, points)
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length)
  return {
    model,
    coefs,
    residuals,
    rmse,
    inlierCount: inliers.filter(Boolean).length,
    pointCount: n,
    usable: true,
  }
}

export function applyCalibration(fit: CalibResult, imgX: number, imgY: number): { x: number; y: number } {
  const c = fit.coefs
  if (fit.model === 'affine') {
    return { x: c[0] + c[1] * imgX + c[2] * imgY, y: c[3] + c[4] * imgX + c[5] * imgY }
  }
  const den = c[6] * imgX + c[7] * imgY + 1
  return { x: (c[0] * imgX + c[1] * imgY + c[2]) / den, y: (c[3] * imgX + c[4] * imgY + c[5]) / den }
}

/** 解析剪贴板 OCR 数值列表（每行一个数字，列优先排列）。
 * 按空白切分后逐项校验；任一 token 非数值则返回 null（调用方应中断导入）。 */
export function parseNumericTokens(text: string): number[] | null {
  const tokens = text.split(/\s+/).filter(s => s !== '')
  if (tokens.length === 0) return null
  const numRe = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
  const out: number[] = []
  for (const t of tokens) {
    if (!numRe.test(t)) return null
    out.push(Number(t))
  }
  return out
}

/** 解析 txt：每行取前两个数值作为图像 X/Y，支持空格/制表/逗号/分号分隔 */
export function parseCalibTxt(text: string): Array<{ imgX: number; imgY: number }> {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const nums = line.split(/[\s,，;；]+/).filter(s => s !== '').map(Number).filter(v => Number.isFinite(v))
      if (nums.length < 2) return null
      return { imgX: nums[0], imgY: nums[1] }
    })
    .filter((p): p is { imgX: number; imgY: number } => p !== null)
}

/** 解析 txt 全部数据：按行取 图像X/Y、物理X/Y、角度（列不足 5 时角度补 0；物理坐标缺失时保持 0） */
export function parseCalibTxtFull(text: string): CalibPoint[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const nums = line.split(/[\s,，;；]+/).filter(s => s !== '').map(Number).filter(v => Number.isFinite(v))
      if (nums.length < 2) return null
      return {
        imgX: nums[0],
        imgY: nums[1],
        physX: nums.length > 2 ? nums[2] : 0,
        physY: nums.length > 3 ? nums[3] : 0,
        angle: nums.length > 4 ? nums[4] : 0,
      }
    })
    .filter((p): p is CalibPoint => p !== null)
}

// ─── Dobot 标定 XML 导出 ─────────────────────────

/** 数值格式化：四舍五入到 9 位有效数字，去掉浮点噪声与尾零 */
function xmlNum(v: number): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  return String(Number(n.toPrecision(9)))
}

/** 把拟合系数转为 3×3 CalibMatrix（图像→物理，行主序） */
export function calibMatrixFromFit(fit: CalibResult | null): number[] {
  const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  if (!fit || !fit.usable || fit.coefs.length < 6) return ident
  const c = fit.coefs
  if (fit.model === 'affine') {
    return [c[1], c[2], c[0], c[4], c[5], c[3], 0, 0, 1]
  }
  return [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], 1]
}

/**
 * 生成 Dobot 标定 XML（与 0807-1-correct.xml 同结构）。
 * 误差/精度字段为近似值：TransWorldError=RMSE(mm)，
 * PixelPrecision=sqrt(|det(线性部分)|) 比例尺，TransError=RMSE/比例尺。
 */
export function buildCalibXml(rows: CalibPoint[], fit: CalibResult | null): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const calibTime = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`

  const usable = !!fit && fit.usable
  const matrix = calibMatrixFromFit(fit)

  let scale = 0
  if (usable && fit!.coefs.length >= 6) {
    const c = fit!.coefs
    const [m00, m01, m10, m11] = fit!.model === 'affine'
      ? [c[1], c[2], c[4], c[5]]
      : [c[0], c[1], c[3], c[4]]
    scale = Math.sqrt(Math.abs(m00 * m11 - m01 * m10))
  }

  const transWorldError = usable ? fit!.rmse : -999
  const transError = usable && scale > 0 ? fit!.rmse / scale : -999
  const calibErrStatus = usable ? 0 : 1

  const pointBlock = (xKey: 'imgX' | 'physX', yKey: 'imgY' | 'physY', rKey: 'angle') =>
    rows.map(r => `            <PointF>\n                <X>${xmlNum(r[xKey])}</X>\n                <Y>${xmlNum(r[yKey])}</Y>\n                <R>${xmlNum(r[rKey])}</R>\n            </PointF>`).join('\n')

  const matrixBlock = matrix.map(v => `            <ParamValue>${xmlNum(v)}</ParamValue>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<CalibInfo>
    <CalibInputParam>
        <CalibParam ParamName="CreateCalibTime" DataType="string">
            <ParamValue>${calibTime}</ParamValue>
        </CalibParam>
        <CalibParam ParamName="CalibType" DataType="string">
            <ParamValue>NPointCalib</ParamValue>
        </CalibParam>
        <CalibParam ParamName="TransNum" DataType="int">
            <ParamValue>${rows.length}</ParamValue>
        </CalibParam>
        <CalibParam ParamName="RotNum" DataType="int">
            <ParamValue>0</ParamValue>
        </CalibParam>
        <CalibParam ParamName="CalibErrStatus" DataType="int">
            <ParamValue>${calibErrStatus}</ParamValue>
        </CalibParam>
        <CalibParam ParamName="TransError" DataType="float">
            <ParamValue>${xmlNum(transError)}</ParamValue>
        </CalibParam>
        <CalibParam ParamName="RotError" DataType="float">
            <ParamValue>-999</ParamValue>
        </CalibParam>
        <CalibParam ParamName="TransWorldError" DataType="float">
            <ParamValue>${xmlNum(transWorldError)}</ParamValue>
        </CalibParam>
        <CalibParam ParamName="RotWorldError" DataType="float">
            <ParamValue>-999</ParamValue>
        </CalibParam>
        <CalibParam ParamName="PixelPrecisionX" DataType="float">
            <ParamValue>${xmlNum(scale)}</ParamValue>
        </CalibParam>
        <CalibParam ParamName="PixelPrecisionY" DataType="float">
            <ParamValue>${xmlNum(scale)}</ParamValue>
        </CalibParam>
        <CalibParam ParamName="PixelPrecision" DataType="float">
            <ParamValue>${xmlNum(scale)}</ParamValue>
        </CalibParam>
        <CalibPointFListParam ParamName="ImagePointLst" DataType="CalibPointList">
${pointBlock('imgX', 'imgY', 'angle')}
        </CalibPointFListParam>
        <CalibPointFListParam ParamName="WorldPointLst" DataType="CalibPointList">
${pointBlock('physX', 'physY', 'angle')}
        </CalibPointFListParam>
    </CalibInputParam>
    <CalibOutputParam>
        <CalibParam ParamName="RotDirectionState" DataType="int">
            <ParamValue>-999</ParamValue>
        </CalibParam>
        <CalibParam ParamName="IsRightCoorA" DataType="int">
            <ParamValue>-1</ParamValue>
        </CalibParam>
        <PointF ParamName="RotCenterImagePoint" DataType="CalibPointF">
            <RotCenterImagePointX>0</RotCenterImagePointX>
            <RotCenterImagePointY>0</RotCenterImagePointY>
            <RotCenterImageR>-999</RotCenterImageR>
        </PointF>
        <PointF ParamName="RotCenterWorldPoint" DataType="CalibPointF">
            <RotCenterWorldPointX>0</RotCenterWorldPointX>
            <RotCenterWorldPointY>0</RotCenterWorldPointY>
            <RotCenterWorldR>-999</RotCenterWorldR>
        </PointF>
        <CalibFloatListParam ParamName="CalibMatrix" DataType="FloatList">
${matrixBlock}
        </CalibFloatListParam>
    </CalibOutputParam>
</CalibInfo>`
}
