/**
 * Dobot Magician 通信协议 (V1.1.5) — 帧封装 / 指令构造 / 返回解析
 * TS 移植自 find-docs/magician-controller/protocol.py
 *
 * 帧格式: AA AA | Len(1字节 = 2 + len(Params)) | ID | Ctrl | Params | Checksum
 * 校验和: ID+Ctrl+Params 之和的低 8 位二补数
 */

export const MAGICIAN_HEADER = Buffer.from([0xaa, 0xaa])
export const MAGICIAN_MAX_FRAME = 500 // 单帧最大长度 (Len)，防伪帧阻塞

// --- 功能 ID ---
export const ID_DEVICE_SN = 0 // GetDeviceSN 读取序列号
export const ID_POSE = 10 // GetPose 读取实时位姿
export const ID_ALARM = 20 // GetAlarmsState / ClearAllAlarmsState
export const ID_HOME = 31 // SetHOMECmd
export const ID_SUCTION = 62 // SetEndEffectorSuctionCup
export const ID_GRIPPER = 63 // SetEndEffectorGripper
export const ID_JOG_COMMON = 72 // SetJOGCommonParams 点动速度/加速度比例
export const ID_JOG = 73 // SetJOGCmd
export const ID_PTP_COMMON = 83 // SetPTPCommonParams 点位速度/加速度比例
export const ID_PTP = 84 // SetPTPCmd
export const ID_QUEUE_START = 240 // SetQueuedCmdStartExec
export const ID_QUEUE_STOP = 241 // SetQueuedCmdStopExec
export const ID_QUEUE_FORCE_STOP = 242
export const ID_QUEUE_CLEAR = 245 // SetQueuedCmdClear

// --- JOG 命令值 (SetJOGCmd.cmd) ---
export const JOG_IDLE = 0 // 停止
export const JOG_AP_DOWN = 1 // X+ / Joint1+
export const JOG_AN_DOWN = 2 // X- / Joint1-
export const JOG_BP_DOWN = 3 // Y+ / Joint2+
export const JOG_BN_DOWN = 4 // Y- / Joint2-
export const JOG_CP_DOWN = 5 // Z+ / Joint3+
export const JOG_CN_DOWN = 6 // Z- / Joint3-
export const JOG_DP_DOWN = 7 // R+ / Joint4+
export const JOG_DN_DOWN = 8 // R- / Joint4-

// --- PTP 模式 (SetPTPCmd.ptpMode) ---
export const PTP_JUMP_XYZ = 0 // 门型运动, 参数为目标点坐标
export const PTP_MOVJ_XYZ = 1 // 关节运动, 参数为目标点坐标
export const PTP_MOVL_XYZ = 2 // 直线运动, 参数为目标点坐标
export const PTP_JUMP_ANGLE = 3 // 门型运动, 参数为目标点关节角
export const PTP_MOVJ_ANGLE = 4 // 关节运动, 参数为目标点关节角
export const PTP_MOVL_ANGLE = 5 // 直线运动, 参数为目标点关节角
export const PTP_MOVJ_INC = 6 // 关节运动, 参数为增量
export const PTP_MOVL_INC = 7 // 直线运动, 参数为增量
export const PTP_MOVJ_XYZ_INC = 8 // 关节运动, 参数为坐标增量

export interface MagicianFrame {
  fid: number
  ctrl: number
  params: Buffer
}

/** 构造指令帧 */
export function buildFrame(fid: number, params: Buffer = Buffer.alloc(0), rw = true, isQueued = true): Buffer {
  const ctrl = (rw ? 0x01 : 0x00) | (isQueued ? 0x02 : 0x00)
  const payload = Buffer.concat([Buffer.from([fid, ctrl]), params])
  const checksum = (-payload.reduce((sum, b) => sum + b, 0)) & 0xff
  return Buffer.concat([MAGICIAN_HEADER, Buffer.from([2 + params.length]), payload, Buffer.from([checksum])])
}

/** 从字节流解析一帧；数据不足/非法返回 null，校验失败抛错 */
export function parseFrame(data: Buffer): { total: number; frame: MagicianFrame } | null {
  if (data.length < 6 || data[0] !== 0xaa || data[1] !== 0xaa) return null
  const length = data[2]
  if (length < 2 || length > MAGICIAN_MAX_FRAME) return null
  const total = 4 + length
  if (data.length < total) return null
  const payload = data.subarray(3, 3 + length)
  const checksum = data[3 + length]
  if ((payload.reduce((sum, b) => sum + b, 0) + checksum) & 0xff) {
    throw new Error('Magician 帧校验失败')
  }
  return { total, frame: { fid: payload[0], ctrl: payload[1], params: payload.subarray(2) } }
}

// --- 指令构造 ---

export function cmdGetPose(): Buffer {
  return buildFrame(ID_POSE, undefined, false, false)
}

export function cmdGetAlarms(): Buffer {
  return buildFrame(ID_ALARM, undefined, false, false)
}

export function cmdClearAlarms(): Buffer {
  return buildFrame(ID_ALARM, undefined, true, false)
}

export function cmdHome(): Buffer {
  return buildFrame(ID_HOME, Buffer.from([1]), true, true) // HOMECmd{cmd=1}
}

/** 点动：持续运动，停止命令走立即指令以获得最快响应 */
export function cmdJog(isJoint: boolean, cmd: number): Buffer {
  return buildFrame(ID_JOG, Buffer.from([isJoint ? 1 : 0, cmd]), true, cmd !== 0)
}

export function cmdPtp(mode: number, x: number, y: number, z: number, r: number): Buffer {
  const params = Buffer.alloc(17)
  params.writeUInt8(mode, 0)
  params.writeFloatLE(x, 1)
  params.writeFloatLE(y, 5)
  params.writeFloatLE(z, 9)
  params.writeFloatLE(r, 13)
  return buildFrame(ID_PTP, params, true, true)
}

/** 点动速度/加速度比例 (1-100)，关节与坐标点动共用 */
export function cmdJogCommon(velocityRatio: number, accelerationRatio: number): Buffer {
  const params = Buffer.alloc(8)
  params.writeFloatLE(velocityRatio, 0)
  params.writeFloatLE(accelerationRatio, 4)
  return buildFrame(ID_JOG_COMMON, params, true, false)
}

/** 点位 (PTP) 速度/加速度比例 (1-100) */
export function cmdPtpCommon(velocityRatio: number, accelerationRatio: number): Buffer {
  const params = Buffer.alloc(8)
  params.writeFloatLE(velocityRatio, 0)
  params.writeFloatLE(accelerationRatio, 4)
  return buildFrame(ID_PTP_COMMON, params, true, false)
}

export function cmdSuction(isCtrlEnabled: boolean, isSucked: boolean): Buffer {
  return buildFrame(ID_SUCTION, Buffer.from([isCtrlEnabled ? 1 : 0, isSucked ? 1 : 0]), true, true)
}

export function cmdGripper(isCtrlEnabled: boolean, isGripped: boolean): Buffer {
  return buildFrame(ID_GRIPPER, Buffer.from([isCtrlEnabled ? 1 : 0, isGripped ? 1 : 0]), true, true)
}

export function cmdQueueStart(): Buffer {
  return buildFrame(ID_QUEUE_START, undefined, true, false)
}

export function cmdQueueStop(): Buffer {
  return buildFrame(ID_QUEUE_STOP, undefined, true, false)
}

export function cmdQueueClear(): Buffer {
  return buildFrame(ID_QUEUE_CLEAR, undefined, true, false)
}

export function cmdEstop(): Buffer {
  return buildFrame(ID_QUEUE_FORCE_STOP, undefined, true, false)
}

// --- 返回解析 ---

export interface MagicianPose {
  x: number
  y: number
  z: number
  r: number
  j1: number
  j2: number
  j3: number
  j4: number
}

/** GetPose 返回: x,y,z,r(float) + jointAngle[4](float, 角度) */
export function parsePose(params: Buffer): MagicianPose {
  return {
    x: params.readFloatLE(0),
    y: params.readFloatLE(4),
    z: params.readFloatLE(8),
    r: params.readFloatLE(12),
    j1: params.readFloatLE(16),
    j2: params.readFloatLE(20),
    j3: params.readFloatLE(24),
    j4: params.readFloatLE(28),
  }
}

/** GetAlarmsState 返回 16 字节位图；返回报警总数 */
export function parseAlarms(params: Buffer): number {
  let count = 0
  for (let i = 0; i < Math.min(16, params.length); i++) {
    count += (params[i].toString(2).match(/1/g) ?? []).length
  }
  return count
}
