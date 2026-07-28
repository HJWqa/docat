/**
 * 离线正/逆运动学（不连设备）
 *
 * 移植自 scripts/offline_kin.py，基于 MG6/Magician E6 两组实测点标定。
 * 适用于：
 *   - user=0, tool=0
 *   - 末端朝下姿态族：RX ≈ ±180°, RY ≈ 0, RZ ≈ 0
 *   - 构型约束：J5 = 90°, J2 + J3 + J4 ≈ -90°
 *
 * 局限：不是全工作空间通用模型；换 tool/user/姿态需重新标定或接真机 IK。
 */

/** 平面臂参数（mm / deg） */
const L2 = 155.0
const L3 = 180.0
const O2 = 105.0
const CX = 105.64215571346386
const CZ = 101.68396883841672
const Y_OFF = -81.2999

/** 标定参考（无 jointNear 时推 J6） */
export const REF_JOINT = [-82.1678, 2.0426, -119.9158, 27.8732, 90.0, 187.8322] as const
export const REF_POSE = [-48.4219, -244.5812, 209.7774, -180.0, 0.0, 0.0] as const

export type Joint6 = [number, number, number, number, number, number]
export type Pose6 = [number, number, number, number, number, number]

export interface IkResult {
  ok: boolean
  joint: Joint6 | null
  candidates: Joint6[]
  message: string
}

function wrapDeg(a: number): number {
  let v = ((a + 180) % 360 + 360) % 360 - 180
  if (v === -180) v = 180
  return v
}

function nearAng(a: number, ref: number): number {
  return a + 360 * Math.round((ref - a) / 360)
}

/**
 * 关节 → 笛卡尔（本标定模型）
 * joint: [J1..J6] deg → [X,Y,Z,RX,RY,RZ] mm/deg
 */
export function forwardKinematics(joint: number[]): Pose6 {
  if (joint.length < 6) throw new Error('joint 需要 6 个数: J1..J6')
  const [j1, j2, j3, j4, j5] = joint.map(Number)

  const a2 = ((j2 + O2) * Math.PI) / 180
  const a23 = ((j2 + j3 + O2) * Math.PI) / 180
  const xArm = CX + L2 * Math.cos(a2) + L3 * Math.cos(a23)
  const z = CZ + L2 * Math.sin(a2) + L3 * Math.sin(a23)

  const th1 = (j1 * Math.PI) / 180
  const c = Math.cos(th1)
  const s = Math.sin(th1)
  const x = c * xArm - s * Y_OFF
  const y = s * xArm + c * Y_OFF

  const confOk = Math.abs(j5 - 90) < 2 && Math.abs(j2 + j3 + j4 + 90) < 2
  if (confOk) {
    return [x, y, z, -180, 0, 0]
  }
  // 未标定构型：位置仍估算，姿态用 NaN 占位
  return [x, y, z, Number.NaN, Number.NaN, Number.NaN]
}

function ikJ1Candidates(x: number, y: number): Array<{ j1: number; xArm: number }> {
  const r = Math.hypot(x, y)
  if (r < Math.abs(Y_OFF) - 1e-6) return []
  const alpha = Math.atan2(x, y)
  const cosPsi = Math.max(-1, Math.min(1, Y_OFF / r))
  const psi = Math.acos(cosPsi)
  const out: Array<{ j1: number; xArm: number }> = []
  for (const sign of [1, -1] as const) {
    const th = sign * psi - alpha
    const j1 = (th * 180) / Math.PI
    const c = Math.cos(th)
    const s = Math.sin(th)
    const xArm = c * x + s * y
    const yChk = -s * x + c * y
    if (Math.abs(yChk - Y_OFF) > 1e-2) continue
    out.push({ j1, xArm })
  }
  return out
}

function ikPlanar(xArm: number, z: number): Array<{ j2: number; j3: number }> {
  const px = xArm - CX
  const pz = z - CZ
  const d2 = px * px + pz * pz
  let cosEl = (d2 - L2 * L2 - L3 * L3) / (2 * L2 * L3)
  if (Math.abs(cosEl) > 1.001) return []
  cosEl = Math.max(-1, Math.min(1, cosEl))
  const out: Array<{ j2: number; j3: number }> = []
  for (const elbowSign of [1, -1] as const) {
    const a3 = elbowSign * Math.acos(cosEl)
    const k1 = L2 + L3 * Math.cos(a3)
    const k2 = L3 * Math.sin(a3)
    const a2 = Math.atan2(pz, px) - Math.atan2(k2, k1)
    const j2 = (a2 * 180) / Math.PI - O2
    const j3 = (a3 * 180) / Math.PI
    out.push({ j2, j3 })
  }
  return out
}

/**
 * 笛卡尔 → 关节（朝下姿态族）
 * pose: [X,Y,Z,RX,RY,RZ]；jointNear 就近选解 + 推 J6
 */
export function inverseKinematics(
  pose: number[],
  jointNear?: number[] | null,
): IkResult {
  if (pose.length < 3) throw new Error('pose 至少要 X,Y,Z')
  const x = Number(pose[0])
  const y = Number(pose[1])
  const z = Number(pose[2])
  const rx = pose.length > 3 ? Number(pose[3]) : -180
  const ry = pose.length > 4 ? Number(pose[4]) : 0
  const rz = pose.length > 5 ? Number(pose[5]) : 0

  const rxN = Math.abs(wrapDeg(rx))
  if (Math.abs(rxN - 180) > 5 || Math.abs(ry) > 5 || Math.abs(rz) > 5) {
    return {
      ok: false,
      joint: null,
      candidates: [],
      message:
        `当前离线模型只支持朝下姿态 RX≈±180, RY≈0, RZ≈0；收到 RX=${rx}, RY=${ry}, RZ=${rz}`,
    }
  }

  let near = (jointNear && jointNear.length >= 6
    ? jointNear.slice(0, 6).map(Number)
    : [...REF_JOINT]) as number[]
  if (near.length < 6) near = [...REF_JOINT]

  const candidates: Joint6[] = []
  for (const { j1: j1Raw, xArm } of ikJ1Candidates(x, y)) {
    const j1 = nearAng(wrapDeg(j1Raw), near[0])
    for (const { j2, j3 } of ikPlanar(xArm, z)) {
      const j4 = -90 - j2 - j3
      const j5 = 90
      const j6 = near[5] + (j1 - near[0])
      const cand: Joint6 = [j1, j2, j3, j4, j5, j6]
      const fk = forwardKinematics(cand)
      const err = Math.sqrt(
        (fk[0] - x) ** 2 + (fk[1] - y) ** 2 + (fk[2] - z) ** 2,
      )
      if (err < 1.0) candidates.push(cand)
    }
  }

  const uniq: Joint6[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const key = c.map(v => v.toFixed(3)).join(',')
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(c)
  }

  if (!uniq.length) {
    return {
      ok: false,
      joint: null,
      candidates: [],
      message: '无解：目标可能超出离线模型工作空间，或姿态不在标定族内',
    }
  }

  const dist = (c: Joint6) =>
    c.reduce((s, v, i) => s + wrapDeg(v - near[i]) ** 2, 0)
  uniq.sort((a, b) => dist(a) - dist(b))
  return {
    ok: true,
    joint: uniq[0],
    candidates: uniq,
    message: `ok, ${uniq.length} candidate(s), nearest selected`,
  }
}

/** 从关节数组构造 joints 对象 */
export function jointsToObject(j: number[]): Record<string, number> {
  return {
    j1: j[0] ?? 0,
    j2: j[1] ?? 0,
    j3: j[2] ?? 0,
    j4: j[3] ?? 0,
    j5: j[4] ?? 0,
    j6: j[5] ?? 0,
  }
}

/** 从 joints 对象读出数组 */
export function jointsFromObject(joints: Record<string, number> | undefined | null): Joint6 {
  if (!joints) return [...REF_JOINT] as Joint6
  return [1, 2, 3, 4, 5, 6].map(n => Number(joints[`j${n}`] ?? 0)) as Joint6
}

/** FK 结果 → pose 对象（含 r 兼容字段） */
export function poseToObject(p: number[]): Record<string, number> {
  const rx = Number.isFinite(p[3]) ? p[3] : -180
  const ry = Number.isFinite(p[4]) ? p[4] : 0
  const rz = Number.isFinite(p[5]) ? p[5] : 0
  return {
    x: p[0] ?? 0,
    y: p[1] ?? 0,
    z: p[2] ?? 0,
    r: rx,
    rx,
    ry,
    rz,
  }
}

/** pose 对象 → 数组 */
export function poseFromObject(pose: Record<string, number> | undefined | null): Pose6 {
  if (!pose) return [...REF_POSE] as Pose6
  return [
    Number(pose.x ?? 0),
    Number(pose.y ?? 0),
    Number(pose.z ?? 0),
    Number(pose.rx ?? pose.r ?? -180),
    Number(pose.ry ?? 0),
    Number(pose.rz ?? 0),
  ]
}

/**
 * 关节点动一步后，用 FK 同步笛卡尔位姿。
 * 若构型不在朝下族，仍更新位置，姿态保持原值。
 */
export function applyJointDelta(
  joints: Record<string, number>,
  pose: Record<string, number>,
  axis: string,
  delta: number,
): { joints: Record<string, number>; pose: Record<string, number> } {
  const nextJoints = { ...joints, [axis]: (joints[axis] ?? 0) + delta }
  // 保持朝下构型：若动的是 J2/J3，联动 J4 使 J2+J3+J4=-90
  if (axis === 'j2' || axis === 'j3') {
    nextJoints.j4 = -90 - (nextJoints.j2 ?? 0) - (nextJoints.j3 ?? 0)
  }
  if (axis === 'j5') {
    // 强制 J5 靠近 90，避免拖出标定族
    nextJoints.j5 = Math.max(88, Math.min(92, nextJoints.j5 ?? 90))
  }
  const jArr = jointsFromObject(nextJoints)
  const fk = forwardKinematics(jArr)
  const nextPose = { ...pose }
  nextPose.x = fk[0]
  nextPose.y = fk[1]
  nextPose.z = fk[2]
  if (Number.isFinite(fk[3])) {
    nextPose.rx = fk[3]
    nextPose.ry = fk[4]
    nextPose.rz = fk[5]
    nextPose.r = fk[3]
  }
  return { joints: nextJoints, pose: nextPose }
}

/**
 * 笛卡尔点动一步后，用 IK 同步关节。
 * 仅在朝下族内可靠；失败时只改 pose，关节保持不变。
 */
export function applyCartesianDelta(
  joints: Record<string, number>,
  pose: Record<string, number>,
  axis: string,
  delta: number,
): { joints: Record<string, number>; pose: Record<string, number>; ok: boolean; message?: string } {
  const nextPose = { ...pose }
  const key = axis === 'r' ? 'rx' : axis
  nextPose[key] = (nextPose[key] ?? 0) + delta
  if (key === 'rx') nextPose.r = nextPose.rx

  const near = jointsFromObject(joints)
  const target = poseFromObject(nextPose)
  // 点动时若姿态仍接近朝下，强制 RY/RZ≈0、RX≈±180，避免浮点漂移踢出模型
  if (Math.abs(Math.abs(wrapDeg(target[3])) - 180) < 10 && Math.abs(target[4]) < 10 && Math.abs(target[5]) < 10) {
    target[3] = target[3] >= 0 ? 180 : -180
    target[4] = 0
    target[5] = 0
    nextPose.rx = target[3]
    nextPose.ry = 0
    nextPose.rz = 0
    nextPose.r = target[3]
  }

  const ik = inverseKinematics(target, near)
  if (!ik.ok || !ik.joint) {
    return { joints, pose: nextPose, ok: false, message: ik.message }
  }
  return {
    joints: jointsToObject(ik.joint),
    pose: nextPose,
    ok: true,
  }
}
