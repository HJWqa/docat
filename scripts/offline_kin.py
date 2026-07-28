#!/usr/bin/env python3
"""
离线正/逆运动学（不连设备）

基于你提供的两组 MG6/Magician E6 实测点标定，适用于：
  - user=0, tool=0（或未改工具坐标系）
  - 末端朝下姿态族：RX ≈ ±180°, RY ≈ 0, RZ ≈ 0
  - 构型约束：J5 = 90°,  J2 + J3 + J4 ≈ -90°

在此姿态族内，位置 FK 误差约 0.01 mm（相对你给的两组点）。

局限（请先读）：
  1. 不是官方 DH，也不是全工作空间通用模型。
  2. 换 tool/user、换姿态（非朝下）、其它机型 → 需要重新标定或接真机 IK。
  3. J6 在固定朝下姿态时与 J1 联动；无 jointNear 时用标定点推一个参考解。
  4. 真机运动前务必再跑一次控制器 InverseKin / 低速验证。

用法：
  python3 scripts/offline_kin.py
  python3 scripts/offline_kin.py fk -- -82.1678 2.0426 -119.9158 27.8732 90 187.8322
  python3 scripts/offline_kin.py ik -- -27.047 -227.9198 236.033 180 0 0
  python3 scripts/offline_kin.py ik -- -27.047 -227.9198 236.033 180 0 0 \\
      --near -82.1678 2.0426 -119.9158 27.8732 90 187.8322
"""

from __future__ import annotations

import argparse
import math
import sys
from typing import Optional, Sequence


# ── 由两组实测点拟合的平面臂参数（mm / deg）────────────────────
# 臂平面内：
#   x_arm = CX + L2*cos(J2+O2) + L3*cos(J2+J3+O2)
#   z     = CZ + L2*sin(J2+O2) + L3*sin(J2+J3+O2)
# 侧向常偏置 Y_OFF（旋转 -J1 后的 y'）
L2 = 155.0
L3 = 180.0
O2 = 105.0          # J2 零位相对几何角的偏移
CX = 105.64215571346386
CZ = 101.68396883841672
Y_OFF = -81.2999

# 标定参考（用于无 jointNear 时推 J6）
_REF_J = [-82.1678, 2.0426, -119.9158, 27.8732, 90.0, 187.8322]
_REF_POSE = [-48.4219, -244.5812, 209.7774, -180.0, 0.0, 0.0]


def _wrap_deg(a: float) -> float:
    """归一化到 (-180, 180]."""
    a = (a + 180.0) % 360.0 - 180.0
    return 180.0 if a == -180.0 else a


def _near_ang(a: float, ref: float) -> float:
    """把角度 a 调整到最接近 ref 的 360° 等价角。"""
    return a + 360.0 * round((ref - a) / 360.0)


def forward_kinematics(joint: Sequence[float]) -> list[float]:
    """
    关节 → 笛卡尔（本标定模型）。

    joint: [J1..J6] 单位 deg
    返回: [X, Y, Z, RX, RY, RZ] 单位 mm / deg

    姿态：在 J5≈90 且 J2+J3+J4≈-90 时输出 RX=-180, RY=0, RZ=0；
    其它构型仍给位置估算，姿态仅作占位（不可靠）。
    """
    if len(joint) < 6:
        raise ValueError("joint 需要 6 个数: J1..J6")
    j1, j2, j3, j4, j5, j6 = (float(x) for x in joint[:6])

    a2 = math.radians(j2 + O2)
    a23 = math.radians(j2 + j3 + O2)
    x_arm = CX + L2 * math.cos(a2) + L3 * math.cos(a23)
    z = CZ + L2 * math.sin(a2) + L3 * math.sin(a23)

    th1 = math.radians(j1)
    c, s = math.cos(th1), math.sin(th1)
    x = c * x_arm - s * Y_OFF
    y = s * x_arm + c * Y_OFF

    # 姿态：当前标定只覆盖朝下族
    conf_ok = abs(j5 - 90.0) < 2.0 and abs(j2 + j3 + j4 + 90.0) < 2.0
    if conf_ok:
        rx, ry, rz = -180.0, 0.0, 0.0
    else:
        # 未标定构型：姿态未知
        rx, ry, rz = float("nan"), float("nan"), float("nan")

    return [x, y, z, rx, ry, rz]


def _ik_j1_candidates(x: float, y: float) -> list[tuple[float, float]]:
    """
    由 (x,y) 与固定侧偏 Y_OFF 解 J1。
    返回 [(j1_deg, x_arm), ...]
    """
    r = math.hypot(x, y)
    if r < abs(Y_OFF) - 1e-6:
        return []
    # y*cos(j1) - x*sin(j1) = Y_OFF
    # <=> R * cos(j1 + alpha) = Y_OFF,  alpha = atan2(x, y)
    alpha = math.atan2(x, y)
    cos_psi = max(-1.0, min(1.0, Y_OFF / r))
    psi = math.acos(cos_psi)
    out: list[tuple[float, float]] = []
    for sign in (+1.0, -1.0):
        th = sign * psi - alpha
        j1 = math.degrees(th)
        c, s = math.cos(th), math.sin(th)
        x_arm = c * x + s * y
        y_chk = -s * x + c * y
        if abs(y_chk - Y_OFF) > 1e-2:
            continue
        out.append((j1, x_arm))
    return out


def _ik_planar(x_arm: float, z: float) -> list[tuple[float, float]]:
    """平面 2R：解 (J2, J3)。返回多解。"""
    px = x_arm - CX
    pz = z - CZ
    d2 = px * px + pz * pz
    cos_el = (d2 - L2 * L2 - L3 * L3) / (2.0 * L2 * L3)
    if abs(cos_el) > 1.001:
        return []
    cos_el = max(-1.0, min(1.0, cos_el))
    out: list[tuple[float, float]] = []
    for elbow_sign in (+1.0, -1.0):
        a3 = elbow_sign * math.acos(cos_el)  # = J3（O3=0）
        k1 = L2 + L3 * math.cos(a3)
        k2 = L3 * math.sin(a3)
        a2 = math.atan2(pz, px) - math.atan2(k2, k1)
        j2 = math.degrees(a2) - O2
        j3 = math.degrees(a3)
        out.append((j2, j3))
    return out


def inverse_kinematics(
    pose: Sequence[float],
    joint_near: Optional[Sequence[float]] = None,
) -> dict:
    """
    笛卡尔 → 关节（朝下姿态族）。

    pose: [X,Y,Z, RX,RY,RZ]  （RX 建议 ±180，RY/RZ ≈ 0）
    joint_near: 可选，就近选解 + 推算 J6

    返回:
      {
        ok: bool,
        joint: [J1..J6] | None,     # 就近最优
        candidates: [[J1..J6], ...],
        message: str,
      }
    """
    if len(pose) < 3:
        raise ValueError("pose 至少要 X,Y,Z")
    x, y, z = (float(v) for v in pose[:3])
    rx = float(pose[3]) if len(pose) > 3 else -180.0
    ry = float(pose[4]) if len(pose) > 4 else 0.0
    rz = float(pose[5]) if len(pose) > 5 else 0.0

    # 姿态检查（允许 ±180 等价）
    rx_n = abs(_wrap_deg(rx))
    if abs(rx_n - 180.0) > 5.0 or abs(ry) > 5.0 or abs(rz) > 5.0:
        return {
            "ok": False,
            "joint": None,
            "candidates": [],
            "message": (
                f"当前离线模型只支持朝下姿态 RX≈±180, RY≈0, RZ≈0；"
                f"收到 RX={rx}, RY={ry}, RZ={rz}。请连真机做 InverseKin。"
            ),
        }

    near = [float(v) for v in (joint_near if joint_near is not None else _REF_J)[:6]]
    if len(near) < 6:
        near = list(_REF_J)

    candidates: list[list[float]] = []
    for j1_raw, x_arm in _ik_j1_candidates(x, y):
        # 归一化后再贴到 jointNear，避免 283° vs -76° 这种 +360 跑偏
        j1 = _near_ang(_wrap_deg(j1_raw), near[0])
        for j2, j3 in _ik_planar(x_arm, z):
            j4 = -90.0 - j2 - j3
            j5 = 90.0
            # 固定朝下时 J6 随 J1 联动（两组实测 ΔJ1 = ΔJ6）
            j6 = near[5] + (j1 - near[0])
            cand = [j1, j2, j3, j4, j5, j6]
            fk = forward_kinematics(cand)
            err = math.sqrt(
                (fk[0] - x) ** 2 + (fk[1] - y) ** 2 + (fk[2] - z) ** 2
            )
            if err < 1.0:  # mm
                candidates.append(cand)

    # 去重（按四舍五入）
    uniq: list[list[float]] = []
    seen: set[tuple[float, ...]] = set()
    for c in candidates:
        key = tuple(round(v, 3) for v in c)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)

    if not uniq:
        return {
            "ok": False,
            "joint": None,
            "candidates": [],
            "message": "无解：目标可能超出该离线模型工作空间，或姿态不在标定族内",
        }

    def dist(c: list[float]) -> float:
        return sum((_wrap_deg(c[i] - near[i])) ** 2 for i in range(6))

    uniq.sort(key=dist)
    best = uniq[0]
    return {
        "ok": True,
        "joint": best,
        "candidates": uniq,
        "message": f"ok, {len(uniq)} candidate(s), nearest selected",
    }


def _fmt(xs: Sequence[float], nd: int = 4) -> str:
    parts = []
    for v in xs:
        if isinstance(v, float) and math.isnan(v):
            parts.append("nan")
        else:
            parts.append(f"{v:.{nd}f}")
    return "[" + ", ".join(parts) + "]"


def _demo() -> int:
    print("=== 离线运动学演示（不连设备）===\n")
    print("标定参考点1:")
    print(f"  joint {_fmt(_REF_J)}")
    print(f"  pose  {_fmt(_REF_POSE)}")

    fk1 = forward_kinematics(_REF_J)
    print(f"\nFK(点1关节) → {_fmt(fk1)}")
    print(
        f"  位置误差 mm: "
        f"{math.sqrt(sum((fk1[i]-_REF_POSE[i])**2 for i in range(3))):.4f}"
    )

    p2_pose = [-27.047, -227.9198, 236.033, 180.0, 0.0, 0.0]
    p2_joint = [-76.022, 12.2459, -118.3444, 16.0986, 90.0, 193.978]
    print("\n标定参考点2:")
    print(f"  joint {_fmt(p2_joint)}")
    print(f"  pose  {_fmt(p2_pose)}")

    ik = inverse_kinematics(p2_pose, joint_near=_REF_J)
    print(f"\nIK(点2位姿, near=点1) → ok={ik['ok']}  {ik['message']}")
    if ik["joint"]:
        print(f"  joint {_fmt(ik['joint'])}")
        print(f"  期望  {_fmt(p2_joint)}")
        ej = [ik["joint"][i] - p2_joint[i] for i in range(6)]
        print(f"  ΔJ    {_fmt(ej)}")

    # 往返
    print("\n往返校验 FK→IK→FK:")
    mid_j = [-80.0, 5.0, -119.0, 24.0, 90.0, 190.0]
    # 满足 J2+J3+J4=-90
    mid_j[3] = -90.0 - mid_j[1] - mid_j[2]
    pose = forward_kinematics(mid_j)
    back = inverse_kinematics(pose, joint_near=mid_j)
    print(f"  J     {_fmt(mid_j)}")
    print(f"  FK    {_fmt(pose)}")
    if back["joint"]:
        print(f"  IK    {_fmt(back['joint'])}")
        pose2 = forward_kinematics(back["joint"])
        print(f"  FK2   {_fmt(pose2)}")
        err = math.sqrt(sum((pose2[i] - pose[i]) ** 2 for i in range(3)))
        print(f"  往返位置误差 {err:.4f} mm")
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(description="离线 FK/IK（MG6 朝下姿态族标定模型）")
    sub = p.add_subparsers(dest="cmd")

    p_fk = sub.add_parser("fk", help="正解: J1..J6 → X Y Z RX RY RZ")
    p_fk.add_argument("j1", type=float)
    p_fk.add_argument("j2", type=float)
    p_fk.add_argument("j3", type=float)
    p_fk.add_argument("j4", type=float)
    p_fk.add_argument("j5", type=float)
    p_fk.add_argument("j6", type=float)

    p_ik = sub.add_parser("ik", help="逆解: X Y Z [RX RY RZ] → J1..J6")
    p_ik.add_argument("x", type=float)
    p_ik.add_argument("y", type=float)
    p_ik.add_argument("z", type=float)
    p_ik.add_argument("rx", type=float, nargs="?", default=-180.0)
    p_ik.add_argument("ry", type=float, nargs="?", default=0.0)
    p_ik.add_argument("rz", type=float, nargs="?", default=0.0)
    p_ik.add_argument(
        "--near",
        nargs=6,
        type=float,
        default=None,
        metavar=("J1", "J2", "J3", "J4", "J5", "J6"),
        help="就近关节（强烈建议）",
    )

    sub.add_parser("demo", help="跑内置两组实测点演示（默认）")

    args = p.parse_args(list(argv) if argv is not None else None)
    cmd = args.cmd or "demo"

    if cmd == "demo":
        return _demo()

    if cmd == "fk":
        joint = [args.j1, args.j2, args.j3, args.j4, args.j5, args.j6]
        pose = forward_kinematics(joint)
        print("coordinate=", _fmt(pose))
        print(
            "X Y Z RX RY RZ =",
            " ".join(f"{v:.4f}" if not math.isnan(v) else "nan" for v in pose),
        )
        return 0

    if cmd == "ik":
        vals = [args.x, args.y, args.z, args.rx, args.ry, args.rz]
        res = inverse_kinematics(vals, joint_near=args.near)
        print("ok =", res["ok"])
        print("message =", res["message"])
        if res["joint"]:
            print("joint =", _fmt(res["joint"]))
            print("J1..J6 =", " ".join(f"{v:.4f}" for v in res["joint"]))
            print(f"candidates ({len(res['candidates'])}):")
            for i, c in enumerate(res["candidates"][:8]):
                mark = " <<" if i == 0 else ""
                print(f"  [{i}] {_fmt(c)}{mark}")
        return 0 if res["ok"] else 1

    p.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
