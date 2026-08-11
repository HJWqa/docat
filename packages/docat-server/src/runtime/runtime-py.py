#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
编排脚本运行时（Python）— stdin/stdout JSON-lines 桥接（仅标准库）

协议：
  发 {type:'ready'}
  收 {type:'init', poses, devices}  /  {type:'script', content}  /  {type:'message', device, text}
     {type:'device-status', name, connected}  /  {type:'poses', poses}
  发 {type:'send', device, text}  {type:'log', level, text}

用户 API（与 JS 语义一致，snake_case）：
  import docat
  docat.devices.send(name, text)
  @docat.devices.on_message('name')        # 装饰器注册
  @docat.devices.on_connect('name')
  @docat.devices.on_disconnect('name')
  docat.devices.is_connected(name)
  docat.poses.get(name, sep=None)          # None→数组；给 sep→字符串
  docat.utils.to_array(text, sep=';') / to_string(arr, sep=';') / sleep(ms)
  docat.log.info / warn / error

执行模型：用户脚本（顶层代码 + 消息处理）在同一 worker 线程内顺序执行，
sleep 只阻塞 worker；stdin 由独立线程持续读取，不丢消息。
"""
import json
import os
import re
import struct
import sys
import threading
import queue
import time
import xml.etree.ElementTree as ET

state = {"poses": [], "devices": [], "exited": False, "base_dir": None}
listeners = {"message": {}, "connect": {}, "disconnect": {}}
# wait_for 轮询 inbox 时未匹配的消息暂存，稍后由 worker 顺序处理
carryover = []
out_lock = threading.Lock()


def _send(msg):
    with out_lock:
        sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def _split_fields(text, sep=";"):
    t = str(text).replace("\r", "").replace("\n", "").strip()
    if not t:
        return []
    parts = [p.strip() for p in t.split(sep)]
    while parts and parts[0] == "":
        parts.pop(0)
    while parts and parts[-1] == "":
        parts.pop()
    return parts


class _Devices:
    def send(self, name, text):
        _send({"type": "send", "device": str(name), "text": str(text)})

    def on_message(self, name):
        def deco(fn):
            listeners["message"].setdefault(name, []).append(fn)
            return fn
        return deco

    def on_connect(self, name):
        def deco(fn):
            listeners["connect"].setdefault(name, []).append(fn)
            return fn
        return deco

    def on_disconnect(self, name):
        def deco(fn):
            listeners["disconnect"].setdefault(name, []).append(fn)
            return fn
        return deco

    def is_connected(self, name):
        for d in state["devices"]:
            if d.get("name") == name:
                return bool(d.get("connected"))
        return False

    def wait_for(self, name, matcher=None, timeout_ms=10000):
        """等待设备下一条匹配的消息（同步，超时抛 TimeoutError）。
        matcher 为字符串时按前缀匹配（startswith），或传函数。"""
        return wait_for_message(str(name), matcher, float(timeout_ms))

    def send_and_wait(self, name, text, matcher=None, timeout_ms=10000):
        self.send(name, text)
        return wait_for_message(str(name), matcher, float(timeout_ms))


class _Poses:
    def get(self, name, sep=None):
        for p in state["poses"]:
            if p.get("name") == name:
                if p.get("type") == "cartesian":
                    pose = p.get("pose", {})
                    arr = [pose.get(k, 0) for k in ("x", "y", "z", "rx", "ry", "rz")]
                else:
                    arr = list(p.get("joint", []))
                if sep is None:
                    return arr
                return sep.join(str(v) for v in arr)
        return None

    def list(self):
        return [p.get("name") for p in state["poses"]]


# ─── 标定转换（图像坐标 ⇄ 物理坐标）──────────────────

def _resolve(path):
    p = str(path)
    base = state.get("base_dir")
    if not base or p.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", p):
        return p
    return os.path.join(base, p)


def _convert_path(path):
    """WSL ⇄ Windows 路径互转（不匹配返回 None）。"""
    m = re.match(r"^/mnt/([a-zA-Z])(/.*)?$", path)
    if m:
        rest = (m.group(2) or "").replace("/", "\\")
        return "%s:%s" % (m.group(1).upper(), rest or "\\")
    m = re.match(r"^([a-zA-Z]):[\\/](.*)$", path)
    if m:
        return "/mnt/%s/%s" % (m.group(1).lower(), (m.group(2) or "").replace("\\", "/"))
    return None


def _read_file(path):
    """读取文件：原路径失败（不存在）时自动做 WSL⇄Windows 路径转换后再试一次。"""
    p = _resolve(path)
    try:
        return open(p, "rb").read()
    except FileNotFoundError:
        converted = _convert_path(p)
        if not converted or converted == p:
            hint = ""
            # Windows 路径常见坑：字符串里反斜杠被转义吞掉（如 "D:\Users" → "D:Users"）
            if "\\" in p and not re.search(r":[\\/]", p):
                hint = "（提示：Windows 路径字符串请用双反斜杠 \"D:\\\\...\" 或正斜杠 \"D:/...\"，推荐正斜杠）"
            raise FileNotFoundError("标定文件不存在：%s%s" % (p, hint))
        try:
            return open(converted, "rb").read()
        except FileNotFoundError:
            raise FileNotFoundError("标定文件不存在：%s（已尝试转换路径：%s）" % (p, converted))


class _Calib:
    """utils.calib：解析 .iwcal/.xml 标定文件并做坐标互转（图像→物理）。"""

    def parse_iwcaf(self, path):
        data = _read_file(path)
        if len(data) < 36:
            raise ValueError("iwcal 文件过小（应为 36B）")
        v = struct.unpack("<9f", data[:36])
        return {"m00": v[0], "m01": v[1], "m02": v[2], "m10": v[3], "m11": v[4], "m12": v[5]}

    def parse_xml(self, path):
        return self.parse_xml_text(_read_file(path).decode("utf-8"))

    def parse_xml_text(self, text):
        root = ET.fromstring(text)
        out = {}
        for item in root.iter("CalibFloatListParam"):
            if item.get("ParamName") == "CalibMatrix":
                values = [float(pv.text.strip()) for pv in item.iter("ParamValue")]
                if len(values) >= 9:
                    out = {"m00": values[0], "m01": values[1], "m02": values[2],
                           "m10": values[3], "m11": values[4], "m12": values[5]}
                break
        if not out:
            raise ValueError("xml 中未找到有效的 CalibMatrix")
        for item in root.iter("CalibParam"):
            if item.get("ParamName") == "PixelPrecision":
                try:
                    p = float(next(iter(item.iter("ParamValue"))).text.strip())
                    if p > 0:
                        out["precision"] = p
                except Exception:
                    pass
        return out

    def image_to_world(self, m, x, y, sep=None):
        wx = m["m00"] * x + m["m01"] * y + m["m02"]
        wy = m["m10"] * x + m["m11"] * y + m["m12"]
        return "%s%s%s" % (wx, sep, wy) if sep is not None else [wx, wy]

    def world_to_image(self, m, wx, wy, sep=None):
        det = m["m00"] * m["m11"] - m["m01"] * m["m10"]
        if abs(det) < 1e-12:
            raise ValueError("标定矩阵不可逆（行列式接近 0）")
        ix = (m["m11"] * (wx - m["m02"]) - m["m01"] * (wy - m["m12"])) / det
        iy = (-m["m10"] * (wx - m["m02"]) + m["m00"] * (wy - m["m12"])) / det
        return "%s%s%s" % (ix, sep, iy) if sep is not None else [ix, iy]


# ─── WSL 路径转换（/mnt/d/... ⇄ D:\...）─────────────

def _wsl_to_win(path):
    p = str(path)
    m = re.match(r"^/mnt/([a-zA-Z])(/.*)?$", p)
    if not m:
        return p
    rest = (m.group(2) or "").replace("/", "\\")
    return "%s:%s" % (m.group(1).upper(), rest or "\\")


def _win_to_wsl(path):
    p = str(path)
    m = re.match(r"^([a-zA-Z]):[\\/](.*)$", p)
    if not m:
        return p
    rest = (m.group(2) or "").replace("\\", "/")
    return "/mnt/%s/%s" % (m.group(1).lower(), rest)


class _Utils:
    def to_array(self, text, sep=";"):
        return _split_fields(text, sep)

    def to_string(self, arr, sep=";"):
        return sep.join(str(v) for v in (arr if isinstance(arr, (list, tuple)) else []))

    def sleep(self, ms):
        left = max(0, int(float(ms)))
        while left > 0 and not state["exited"]:
            step = min(50, left)
            time.sleep(step / 1000.0)
            left -= step
        if state["exited"]:
            raise SystemExit

    def wsl_to_win(self, path):
        return _wsl_to_win(path)

    def win_to_wsl(self, path):
        return _win_to_wsl(path)

    calib = _Calib()


class _Log:
    def info(self, text):
        _send({"type": "log", "level": "info", "text": str(text)})

    def warn(self, text):
        _send({"type": "log", "level": "warn", "text": str(text)})

    def error(self, text):
        _send({"type": "log", "level": "error", "text": str(text)})


docat = type("docat", (), {
    "devices": _Devices(),
    "poses": _Poses(),
    "utils": _Utils(),
    "log": _Log(),
})()

# 支持用户脚本里 import docat
sys.modules["docat"] = docat

# ─── 输入线程：stdin → 队列 ──────────────────────────

inbox = queue.Queue()


def _reader():
    for line in sys.stdin:
        line = line.strip()
        if line:
            try:
                inbox.put(json.loads(line))
            except Exception:
                pass
    state["exited"] = True


threading.Thread(target=_reader, daemon=True).start()


def _dispatch(ev):
    etype = ev.get("type")
    if etype == "message":
        for fn in list(listeners["message"].get(ev.get("device"), [])):
            fn(str(ev.get("text", "")))
    elif etype == "connect":
        for fn in list(listeners["connect"].get(ev.get("name"), [])):
            fn()
    elif etype == "disconnect":
        for fn in list(listeners["disconnect"].get(ev.get("name"), [])):
            fn()


def _match_text(text, matcher):
    if matcher is None:
        return False
    if callable(matcher):
        return bool(matcher(text))
    return str(text).startswith(str(matcher))


def wait_for_message(name, matcher, timeout_ms):
    """轮询 inbox 等待匹配消息；未匹配的消息进入 carryover 由 worker 后续处理。"""
    deadline = time.time() + max(0.0, timeout_ms) / 1000.0
    while time.time() < deadline and not state["exited"]:
        try:
            ev = inbox.get_nowait()
        except queue.Empty:
            time.sleep(0.02)
            continue
        if ev.get("type") == "message" and ev.get("device") == name \
                and _match_text(ev.get("text", ""), matcher):
            return str(ev.get("text", ""))
        carryover.append(ev)
    raise TimeoutError("等待 %s 应答超时（%dms）" % (name, int(timeout_ms)))


def _has_listeners():
    return any(listeners[k] for k in ("message", "connect", "disconnect"))


def run_user_script(code):
    try:
        g = {"docat": docat, "__name__": "__main__"}
        exec(compile(code, "user-script.py", "exec"), g)
        if state["exited"]:
            return
        if not _has_listeners():
            _send({"type": "log", "level": "info", "text": "脚本运行结束"})
            state["exited"] = True
            sys.exit(0)
        _send({"type": "log", "level": "info", "text": "顶层代码执行完毕（脚本保持监听）"})
    except SystemExit:
        pass
    except Exception as exc:
        line = getattr(exc, "lineno", None) if isinstance(exc, SyntaxError) else None
        column = getattr(exc, "offset", None) if isinstance(exc, SyntaxError) else None
        line_text = "（第 %s 行%s）" % (line, "，第 %s 列" % column if column else "") if line else ""
        payload = {"type": "log", "level": "error", "text": "脚本异常: %s%s" % (exc, line_text)}
        if line:
            payload["line"] = int(line)
        if column:
            payload["column"] = int(column)
        _send(payload)
        state["exited"] = True
        sys.exit(1)


def _worker():
    """顺序处理：init/script → 顶层代码 → 后续消息事件"""
    ran = False
    while not state["exited"]:
        # 优先处理 wait_for 轮询后未匹配的消息（保持顺序）
        if carryover:
            ev = carryover.pop(0)
        else:
            try:
                ev = inbox.get(timeout=0.2)
            except queue.Empty:
                continue
        etype = ev.get("type")
        if etype == "init":
            state["poses"] = ev.get("poses", [])
            state["devices"] = ev.get("devices", [])
        elif etype == "poses":
            state["poses"] = ev.get("poses", [])
        elif etype == "device-status":
            name, connected = ev.get("name"), ev.get("connected")
            state["devices"] = [
                {**d, "connected": connected} if d.get("name") == name else d
                for d in state["devices"]
            ]
            if ran:
                try:
                    _dispatch({"type": "connect" if connected else "disconnect", "name": name})
                except SystemExit:
                    raise
                except Exception as exc:
                    _send({"type": "log", "level": "error", "text": "脚本异常: %s" % exc})
        elif etype == "message":
            if ran:
                try:
                    _dispatch(ev)
                except SystemExit:
                    raise
                except Exception as exc:
                    _send({"type": "log", "level": "error", "text": "脚本异常: %s" % exc})
        elif etype == "script":
            ran = True
            run_user_script(str(ev.get("content", "")))


if __name__ == "__main__":
    _send({"type": "ready"})
    try:
        _worker()
    except Exception:
        pass
    finally:
        state["exited"] = True
