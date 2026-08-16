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
  docat.poses.get(name, sep=None, digits=None)  # None→数组；给 sep→字符串（digits 覆盖小数位数）
  docat.utils.to_array(text, sep=';') / to_string(arr, sep=';', digits=None) / sleep(ms)
  docat.utils.barcode.decode(path)   # 二维码/条码识别（zxing-cpp 可选依赖，懒加载）
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
import traceback
import xml.etree.ElementTree as ET

# 强制 UTF-8 输出（与 Node 侧 StringDecoder('utf-8') 解码一致，避免 Windows GBK 乱码；
# 即使服务端环境变量被剥离，协议仍保持 UTF-8）
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

state = {"poses": [], "devices": [], "exited": False, "base_dir": None, "decimal_digits": 6}
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


def _fmt_num(v, digits=None):
    """浮点固定小数位（去尾零），避免科学计数法（如 8.3e-17）；非 float 原样字符串化。
    digits 缺省用通用设置（init 下发）。"""
    if isinstance(v, float):
        d = int(digits) if digits is not None else state["decimal_digits"]
        s = format(v, ".%df" % min(12, max(0, d))).rstrip("0").rstrip(".")
        return "0" if s in ("", "-0") else s
    return str(v)


def _join_values(arr, sep, digits=None):
    return sep.join(_fmt_num(v, digits) for v in arr)


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
    def get(self, name, sep=None, digits=None):
        for p in state["poses"]:
            if p.get("name") == name:
                if p.get("type") == "cartesian":
                    pose = p.get("pose", {})
                    arr = [pose.get(k, 0) for k in ("x", "y", "z", "rx", "ry", "rz")]
                else:
                    arr = list(p.get("joint", []))
                if sep is None:
                    return arr
                return _join_values(arr, sep, digits)
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


def _read_file(path, what="标定文件"):
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
            raise FileNotFoundError("%s不存在：%s%s" % (what, p, hint))
        try:
            return open(converted, "rb").read()
        except FileNotFoundError:
            raise FileNotFoundError("%s不存在：%s（已尝试转换路径：%s）" % (what, p, converted))


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

    def image_to_world(self, m, x, y, sep=None, digits=None):
        wx = m["m00"] * x + m["m01"] * y + m["m02"]
        wy = m["m10"] * x + m["m11"] * y + m["m12"]
        return _join_values([wx, wy], sep, digits) if sep is not None else [wx, wy]

    def world_to_image(self, m, wx, wy, sep=None, digits=None):
        det = m["m00"] * m["m11"] - m["m01"] * m["m10"]
        if abs(det) < 1e-12:
            raise ValueError("标定矩阵不可逆（行列式接近 0）")
        ix = (m["m11"] * (wx - m["m02"]) - m["m01"] * (wy - m["m12"])) / det
        iy = (-m["m10"] * (wx - m["m02"]) + m["m00"] * (wy - m["m12"])) / det
        return _join_values([ix, iy], sep, digits) if sep is not None else [ix, iy]


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


class _Barcode:
    """utils.barcode：二维码 / 一维条码识别（zxing-cpp，可选依赖）。

    依赖首次调用时懒加载（不阻塞 ready 握手）；缺失时抛错并给出安装命令。
    解码核心 zxing-cpp（pip install zxing-cpp），读图用 opencv（imdecode 支持 BMP/中文路径）。
    """

    _deps = None

    @classmethod
    def _load_deps(cls):
        if cls._deps is None:
            try:
                import zxingcpp
            except ImportError:
                raise RuntimeError(
                    "识别需要 zxing-cpp：请在服务端 Python 环境安装 `pip install zxing-cpp opencv-contrib-python`"
                )
            try:
                import cv2
                import numpy as np
            except ImportError:
                raise RuntimeError(
                    "识别需要 opencv（读图）：请在服务端 Python 环境安装 `pip install opencv-contrib-python`"
                )
            cls._deps = (zxingcpp, cv2, np)
        return cls._deps

    def decode(self, path):
        """识别图片中的二维码/条码，返回 [{'format', 'text', 'corners'}]（无码返回 []）。

        corners 为四角像素坐标 [(TL), (TR), (BR), (BL)]，可接 utils.calib 转物理坐标。
        路径支持 WSL⇄Windows 自动转换（同 utils.calib）。
        """
        zxingcpp, cv2, np = self._load_deps()
        data = _read_file(path, "图片文件")  # 原路径失败时自动 WSL⇄Windows 转换重试
        img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("无法解析图片（格式不支持或文件损坏）：%s" % path)
        results = []
        for r in zxingcpp.read_barcodes(img):
            p = r.position
            results.append({
                "format": r.format.name,
                "text": r.text,
                "corners": [
                    (round(p.top_left.x), round(p.top_left.y)),
                    (round(p.top_right.x), round(p.top_right.y)),
                    (round(p.bottom_right.x), round(p.bottom_right.y)),
                    (round(p.bottom_left.x), round(p.bottom_left.y)),
                ],
            })
        return results


class _Utils:
    def to_array(self, text, sep=";"):
        return _split_fields(text, sep)

    def to_string(self, arr, sep=";", digits=None):
        return _join_values(arr, sep, digits) if isinstance(arr, (list, tuple)) else ""

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
    barcode = _Barcode()


class _Log:
    def _fmt(self, *args):
        return " ".join(str(a) for a in args)

    def info(self, *text):
        _send({"type": "log", "level": "info", "text": self._fmt(*text)})

    def warn(self, *text):
        _send({"type": "log", "level": "warn", "text": self._fmt(*text)})

    def error(self, *text):
        _send({"type": "log", "level": "error", "text": self._fmt(*text)})


docat = type("docat", (), {
    "devices": _Devices(),
    "poses": _Poses(),
    "utils": _Utils(),
    "log": _Log(),
})()

# 支持用户脚本里 import docat
sys.modules["docat"] = docat

# ─── 输入线程：stdin → 队列 ──────────────────────────
# stdin 优先设为非阻塞（管道）：若读取线程阻塞在管道读上，Windows 下脚本里
# `import numpy`（及 cv2/pandas 等依赖 numpy 的库）会死锁（实测复现）。
# 非阻塞设置失败（如手动终端运行）时回退为阻塞逐行读取。
# 非阻塞语义：无数据返回 None；父进程关闭 stdin 返回 b''（EOF）。

inbox = queue.Queue()

_stdin_nonblocking = False
try:
    os.set_blocking(sys.stdin.fileno(), False)
    _stdin_nonblocking = True
except OSError:
    pass


def _reader():
    if not _stdin_nonblocking:
        for line in sys.stdin:
            line = line.strip()
            if line:
                try:
                    inbox.put(json.loads(line))
                except Exception:
                    pass
        state["exited"] = True
        return
    buf = b""
    while not state["exited"]:
        try:
            chunk = sys.stdin.buffer.read(65536)
        except (BlockingIOError, OSError):
            chunk = None
        if chunk is None:
            time.sleep(0.01)
            continue
        if not chunk:
            break  # EOF：父进程关闭了 stdin
        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            raw = raw.strip()
            if raw:
                try:
                    inbox.put(json.loads(raw.decode("utf-8", errors="replace")))
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


USER_SCRIPT_NAME = "user-script.py"


def _exc_line_info(exc):
    """提取用户脚本异常的行号/列号（SyntaxError 用自带字段，运行时异常回溯取 user-script.py 帧）。"""
    if isinstance(exc, SyntaxError):
        line = getattr(exc, "lineno", None)
        column = getattr(exc, "offset", None)
        return (int(line), int(column)) if line else (None, None)
    tb = getattr(exc, "__traceback__", None)
    if tb is None:
        return (None, None)
    line = None
    column = None
    for frame in traceback.extract_tb(tb):
        if frame.filename == USER_SCRIPT_NAME:
            line = frame.lineno
            # Python 3.11+ 提供位置信息（列号），旧版本无法获得
            try:
                col = frame.positions[1]
                column = int(col) if col is not None else None
            except Exception:
                column = None
    return (line, column)


def _report_exception(exc):
    """发送脚本异常日志（带用户脚本行号/列号，供编辑器波浪线定位）。"""
    line, column = _exc_line_info(exc)
    line_text = ""
    if line:
        line_text = "（第 %s 行%s）" % (line, "，第 %s 列" % column if column else "")
    payload = {"type": "log", "level": "error", "text": "脚本异常: %s%s" % (exc, line_text)}
    if line:
        payload["line"] = int(line)
    if column:
        payload["column"] = int(column)
    _send(payload)


def _print(*args, **kwargs):
    """脚本内 print 转发到日志面板（info 级）。
    输出不落进程 stdout，避免被父进程误当协议消息执行或报"非 JSON"错误。
    仅注入用户脚本作用域（g['print']），不劫持 builtins.print / 第三方模块输出。
    """
    sep = kwargs.get("sep") or " "
    text = sep.join(str(a) for a in args)
    if not text:
        return  # print() 裸换行/空内容跳过，避免日志刷屏
    _send({"type": "log", "level": "info", "text": text})


def run_user_script(code):
    try:
        g = {"docat": docat, "__name__": "__main__", "print": _print}
        exec(compile(code, USER_SCRIPT_NAME, "exec"), g)
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
        _report_exception(exc)
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
            if "decimalDigits" in ev:
                state["decimal_digits"] = max(0, min(12, int(ev.get("decimalDigits", 6))))
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
                    _report_exception(exc)
        elif etype == "message":
            if ran:
                try:
                    _dispatch(ev)
                except SystemExit:
                    raise
                except Exception as exc:
                    _report_exception(exc)
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
