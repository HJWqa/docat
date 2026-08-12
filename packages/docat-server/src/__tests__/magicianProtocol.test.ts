import { describe, expect, it } from 'vitest'
import {
  buildFrame,
  parseFrame,
  cmdGetPose,
  cmdHome,
  cmdJog,
  cmdPtp,
  cmdSuction,
  cmdGripper,
  parsePose,
  parseAlarms,
  JOG_AP_DOWN,
  JOG_IDLE,
  PTP_MOVJ_ANGLE,
  ID_POSE,
  ID_HOME,
  ID_JOG,
  ID_PTP,
  ID_SUCTION,
  ID_GRIPPER,
} from '../device/protocol/magicianProtocol.js'

describe('magician protocol', () => {
  it('builds frames with correct header/len/checksum (AA AA 02 14 00 EC)', () => {
    // 报警文档示例: GetAlarmsState → AA AA 02 14 00 EC
    const frame = buildFrame(20, undefined, false, false)
    expect([...frame]).toEqual([0xaa, 0xaa, 0x02, 20, 0x00, 0xec])
  })

  it('round-trips frame parsing', () => {
    const frame = cmdHome()
    const parsed = parseFrame(frame)
    expect(parsed).not.toBeNull()
    expect(parsed!.total).toBe(frame.length)
    expect(parsed!.frame.fid).toBe(ID_HOME)
    // 回显 rw=1；响应帧 rw=0
    expect(parsed!.frame.ctrl & 0x01).toBe(1)
    expect([...parsed!.frame.params]).toEqual([1])
  })

  it('rejects corrupted checksum', () => {
    const frame = cmdHome()
    const bad = Buffer.from(frame)
    bad[bad.length - 1] = (bad[bad.length - 1]! + 1) & 0xff
    expect(() => parseFrame(bad)).toThrow()
  })

  it('cmdGetPose is a read (rw=0), non-queued frame', () => {
    const parsed = parseFrame(cmdGetPose())!
    expect(parsed.frame.fid).toBe(ID_POSE)
    expect(parsed.frame.ctrl & 0x01).toBe(0)
    expect(parsed.frame.ctrl & 0x02).toBe(0)
  })

  it('cmdJog uses queued frame for motion and immediate frame for idle', () => {
    const start = parseFrame(cmdJog(true, JOG_AP_DOWN))!
    expect(start.frame.fid).toBe(ID_JOG)
    expect(start.frame.ctrl & 0x02).toBe(0x02) // queued
    const stop = parseFrame(cmdJog(true, JOG_IDLE))!
    expect(stop.frame.ctrl & 0x02).toBe(0) // immediate
  })

  it('cmdPtp packs mode + 4 floats', () => {
    const parsed = parseFrame(cmdPtp(PTP_MOVJ_ANGLE, 1.5, -2.5, 3.5, 90.25))!
    expect(parsed.frame.fid).toBe(ID_PTP)
    expect(parsed.frame.params.length).toBe(17)
    expect(parsed.frame.params[0]).toBe(PTP_MOVJ_ANGLE)
    expect(parsed.frame.params.readFloatLE(1)).toBeCloseTo(1.5)
    expect(parsed.frame.params.readFloatLE(13)).toBeCloseTo(90.25)
  })

  it('suction/gripper pack 2 bool bytes', () => {
    const s = parseFrame(cmdSuction(true, true))!
    expect(s.frame.fid).toBe(ID_SUCTION)
    expect([...s.frame.params]).toEqual([1, 1])
    const g = parseFrame(cmdGripper(true, false))!
    expect(g.frame.fid).toBe(ID_GRIPPER)
    expect([...g.frame.params]).toEqual([1, 0])
  })

  it('parses pose (8 floats)', () => {
    const params = Buffer.alloc(32)
    const vals = [10, 20, 30, 45, 0, 90, -90, 180]
    vals.forEach((v, i) => params.writeFloatLE(v, i * 4))
    const pose = parsePose(params)
    expect(pose.x).toBeCloseTo(10)
    expect(pose.y).toBeCloseTo(20)
    expect(pose.z).toBeCloseTo(30)
    expect(pose.r).toBeCloseTo(45)
    expect(pose.j4).toBeCloseTo(180)
  })

  it('counts alarm bits', () => {
    expect(parseAlarms(Buffer.from([0b10100001]))).toBe(3)
    expect(parseAlarms(Buffer.alloc(16))).toBe(0)
  })
})
