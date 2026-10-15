"""Small native integrations; drawing and text input remain Qt's responsibility.

Bindings describe physical keys. In particular, ``ctrl`` always means the
Control key, even though Qt normally maps its ControlModifier to Command on Mac.
All methods must be called on the QApplication thread.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import os
import sys
from dataclasses import dataclass
from itertools import count
from typing import Any

from PySide6.QtCore import QAbstractNativeEventFilter, QCoreApplication, QObject, Signal


_HOTKEY_IDS = count(1)


def _fourcc(value: str) -> int:
    return int.from_bytes(value.encode("ascii"), "big")


_MAC_KEYS = {
    "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6,
    "X": 7, "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14,
    "R": 15, "Y": 16, "T": 17, "1": 18, "2": 19, "3": 20,
    "4": 21, "6": 22, "5": 23, "Equal": 24, "9": 25, "7": 26,
    "Minus": 27, "8": 28, "0": 29, "BracketRight": 30, "O": 31,
    "U": 32, "BracketLeft": 33, "I": 34, "P": 35, "Return": 36,
    "L": 37, "J": 38, "Quote": 39, "K": 40, "Semicolon": 41,
    "Backslash": 42, "Comma": 43, "Slash": 44, "N": 45, "M": 46,
    "Period": 47, "Tab": 48, "Space": 49, "Backquote": 50,
    "Backspace": 51, "Escape": 53, "F1": 122, "F2": 120,
    "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98,
    "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111,
    "Home": 115, "PageUp": 116, "Delete": 117, "End": 119,
    "PageDown": 121, "ArrowLeft": 123, "ArrowRight": 124,
    "ArrowDown": 125, "ArrowUp": 126,
}
_WIN_KEYS = {
    **{chr(value): value for value in range(ord("A"), ord("Z") + 1)},
    **{str(value): ord(str(value)) for value in range(10)},
    **{f"F{value}": 0x70 + value - 1 for value in range(1, 13)},
    "Space": 0x20, "Comma": 0xBC, "Period": 0xBE, "Minus": 0xBD,
    "Equal": 0xBB, "BracketLeft": 0xDB, "BracketRight": 0xDD,
    "Backslash": 0xDC, "Semicolon": 0xBA, "Quote": 0xDE,
    "Slash": 0xBF, "Backquote": 0xC0, "Return": 0x0D, "Tab": 0x09,
    "Backspace": 0x08, "Delete": 0x2E, "Escape": 0x1B,
    "Home": 0x24, "End": 0x23, "PageUp": 0x21, "PageDown": 0x22,
    "ArrowLeft": 0x25, "ArrowUp": 0x26, "ArrowRight": 0x27,
    "ArrowDown": 0x28,
}


def _normalize_binding(binding: dict) -> tuple[str, bool, bool, bool, bool]:
    if not isinstance(binding, dict):
        raise ValueError("단축키 형식이 올바르지 않습니다.")
    key = str(binding.get("key", ""))
    if len(key) == 1 and key.isascii() and key.isalnum():
        key = key.upper()
    modifiers = tuple(bool(binding.get(name, False)) for name in ("ctrl", "shift", "alt", "meta"))
    if not any(modifiers):
        raise ValueError("전역 단축키에는 Control, Shift, Alt 또는 Meta 조합이 필요합니다.")
    return (key, *modifiers)


class _ObjC:
    """Use a separate ABI-correct objc_msgSend prototype for each signature."""

    def __init__(self) -> None:
        self.appkit = ctypes.CDLL("/System/Library/Frameworks/AppKit.framework/AppKit")
        self.lib = ctypes.CDLL(ctypes.util.find_library("objc") or "/usr/lib/libobjc.A.dylib")
        self.lib.objc_getClass.argtypes = [ctypes.c_char_p]
        self.lib.objc_getClass.restype = ctypes.c_void_p
        self.lib.sel_registerName.argtypes = [ctypes.c_char_p]
        self.lib.sel_registerName.restype = ctypes.c_void_p
        self._send_address = ctypes.cast(self.lib.objc_msgSend, ctypes.c_void_p).value
        self._functions: dict[tuple, Any] = {}

    def cls(self, name: str) -> int:
        value = self.lib.objc_getClass(name.encode("ascii"))
        if not value:
            raise RuntimeError(f"AppKit 클래스를 찾지 못했습니다: {name}")
        return value

    def send(self, receiver: int, selector: str, result=ctypes.c_void_p, args=(), values=()):
        if not receiver:
            raise RuntimeError(f"AppKit 객체가 없습니다: {selector}")
        signature = (result, *args)
        function = self._functions.get(signature)
        if function is None:
            function = ctypes.CFUNCTYPE(result, ctypes.c_void_p, ctypes.c_void_p, *args)(self._send_address)
            self._functions[signature] = function
        return function(receiver, self.lib.sel_registerName(selector.encode("ascii")), *values)

    def responds(self, receiver: int, selector: str) -> bool:
        target = self.lib.sel_registerName(selector.encode("ascii"))
        return bool(self.send(receiver, "respondsToSelector:", ctypes.c_bool, (ctypes.c_void_p,), (target,)))

    def string(self, value: int) -> str:
        if not value:
            return ""
        raw = self.send(value, "UTF8String", ctypes.c_char_p)
        return raw.decode("utf-8") if raw else ""


@dataclass(frozen=True)
class _MacForeground:
    pid: int
    bundle_id: str


class _EventTypeSpec(ctypes.Structure):
    _fields_ = [("eventClass", ctypes.c_uint32), ("eventKind", ctypes.c_uint32)]


class _EventHotKeyID(ctypes.Structure):
    _fields_ = [("signature", ctypes.c_uint32), ("id", ctypes.c_uint32)]


class _MacBackend:
    _signature = _fourcc("MyBr")
    _callback_type = ctypes.CFUNCTYPE(ctypes.c_int32, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)

    def __init__(self, owner: "DesktopIntegration") -> None:
        self.owner = owner
        self.objc = _ObjC()
        self.carbon = ctypes.CDLL("/System/Library/Frameworks/Carbon.framework/Carbon")
        pointer = ctypes.c_void_p
        uint32 = ctypes.c_uint32
        self.carbon.GetApplicationEventTarget.argtypes = []
        self.carbon.GetApplicationEventTarget.restype = pointer
        self.carbon.InstallEventHandler.argtypes = [pointer, self._callback_type, uint32, ctypes.POINTER(_EventTypeSpec), pointer, ctypes.POINTER(pointer)]
        self.carbon.InstallEventHandler.restype = ctypes.c_int32
        self.carbon.RemoveEventHandler.argtypes = [pointer]
        self.carbon.RemoveEventHandler.restype = ctypes.c_int32
        self.carbon.RegisterEventHotKey.argtypes = [uint32, uint32, _EventHotKeyID, pointer, uint32, ctypes.POINTER(pointer)]
        self.carbon.RegisterEventHotKey.restype = ctypes.c_int32
        self.carbon.UnregisterEventHotKey.argtypes = [pointer]
        self.carbon.UnregisterEventHotKey.restype = ctypes.c_int32
        self.carbon.GetEventParameter.argtypes = [pointer, uint32, uint32, ctypes.POINTER(uint32), uint32, ctypes.POINTER(uint32), pointer]
        self.carbon.GetEventParameter.restype = ctypes.c_int32
        self.carbon.GetEventKind.argtypes = [pointer]
        self.carbon.GetEventKind.restype = uint32
        self._callback = self._callback_type(self._on_event)
        self._handler = pointer()
        self._target = self.carbon.GetApplicationEventTarget()
        self._refs: dict[int, ctypes.c_void_p] = {}
        self._current_id: int | None = None
        self._binding = None
        self._pressed = False

    def _install_handler(self) -> tuple[bool, str]:
        if self._handler.value:
            return True, ""
        events = (_EventTypeSpec * 2)(
            _EventTypeSpec(_fourcc("keyb"), 5),
            _EventTypeSpec(_fourcc("keyb"), 6),
        )
        status = self.carbon.InstallEventHandler(self._target, self._callback, 2, events, None, ctypes.byref(self._handler))
        return status == 0, "" if status == 0 else f"macOS 단축키 이벤트 설치 실패 (OSStatus {status})"

    def _on_event(self, _handler, event, _data) -> int:
        identifier = _EventHotKeyID()
        status = self.carbon.GetEventParameter(event, _fourcc("----"), _fourcc("hkid"), None, ctypes.sizeof(identifier), None, ctypes.byref(identifier))
        if status or identifier.signature != self._signature or identifier.id != self._current_id:
            return -9874  # eventNotHandledErr; preserve unrelated handlers.
        if self.carbon.GetEventKind(event) == 6:
            self._pressed = False
        elif not self._pressed:
            self._pressed = True
            # Keep UI work outside the Carbon C callback's call stack.
            self.owner._nativeActivated.emit()
        return 0

    def register(self, binding) -> tuple[bool, str]:
        if binding == self._binding:
            return True, ""
        key, ctrl, shift, alt, meta = binding
        if key not in _MAC_KEYS:
            return False, f"macOS에서 지원하지 않는 전역 키입니다: {key}"
        ok, error = self._install_handler()
        if not ok:
            return False, error
        modifiers = (4096 if ctrl else 0) | (512 if shift else 0) | (2048 if alt else 0) | (256 if meta else 0)
        identifier = next(_HOTKEY_IDS)
        reference = ctypes.c_void_p()
        status = self.carbon.RegisterEventHotKey(_MAC_KEYS[key], modifiers, _EventHotKeyID(self._signature, identifier), self._target, 1, ctypes.byref(reference))
        if status:
            reason = "다른 앱·시스템 단축키와의 충돌을 확인하세요." if status == -9878 else "macOS 로그인 세션에서 실행 중인지 확인하세요."
            return False, f"전역 단축키 등록 실패. {reason} (OSStatus {status})"
        self._refs[identifier] = reference
        previous = self._current_id
        if previous is not None:
            status = self.carbon.UnregisterEventHotKey(self._refs[previous])
            if status:
                rollback = self.carbon.UnregisterEventHotKey(reference)
                if rollback == 0:
                    del self._refs[identifier]
                return False, f"이전 전역 단축키 해제 실패 (OSStatus {status}, 새 조합 복구 상태 {rollback})"
            del self._refs[previous]
        self._current_id, self._binding = identifier, binding
        self._pressed = False
        return True, ""

    def close(self) -> None:
        self._current_id = None
        for reference in self._refs.values():
            self.carbon.UnregisterEventHotKey(reference)
        self._refs.clear()
        if self._handler.value:
            self.carbon.RemoveEventHandler(self._handler)
            self._handler = ctypes.c_void_p()

    def foreground(self):
        workspace = self.objc.send(self.objc.cls("NSWorkspace"), "sharedWorkspace")
        app = self.objc.send(workspace, "frontmostApplication")
        if not app:
            return None
        pid = self.objc.send(app, "processIdentifier", ctypes.c_int32)
        if pid == os.getpid():
            return None
        bundle_id = self.objc.string(self.objc.send(app, "bundleIdentifier"))
        return _MacForeground(pid, bundle_id)

    def restore(self, token) -> bool:
        if not isinstance(token, _MacForeground):
            return False
        target = self.objc.send(self.objc.cls("NSRunningApplication"), "runningApplicationWithProcessIdentifier:", args=(ctypes.c_int32,), values=(token.pid,))
        if not target or self.objc.send(target, "isTerminated", ctypes.c_bool):
            return False
        if self.objc.string(self.objc.send(target, "bundleIdentifier")) != token.bundle_id:
            return False
        application = self.objc.send(self.objc.cls("NSApplication"), "sharedApplication")
        if self.objc.responds(application, "yieldActivationToApplication:"):
            self.objc.send(application, "yieldActivationToApplication:", None, (ctypes.c_void_p,), (target,))
        current = self.objc.send(self.objc.cls("NSRunningApplication"), "currentApplication")
        if self.objc.responds(target, "activateFromApplication:options:"):
            accepted = self.objc.send(target, "activateFromApplication:options:", ctypes.c_bool, (ctypes.c_void_p, ctypes.c_ulong), (current, 0))
        else:
            accepted = self.objc.send(target, "activateWithOptions:", ctypes.c_bool, (ctypes.c_ulong,), (0,))
        # This reports an accepted OS request; actual app activation is asynchronous.
        return bool(accepted)

    def configure(self, widget) -> None:
        view = int(widget.winId())  # Qt Cocoa's WId is an NSView, not an NSWindow.
        window = self.objc.send(view, "window")
        if not window:
            raise RuntimeError("Qt 오버레이의 macOS 창을 찾지 못했습니다.")
        behavior = self.objc.send(window, "collectionBehavior", ctypes.c_ulong)
        # Qt Tool windows may use MoveToActiveSpace/FullScreenNone. AppKit raises
        # an Objective-C exception for incompatible combinations, so replace them.
        behavior &= ~((1 << 1) | (1 << 7) | (1 << 9))
        self.objc.send(window, "setCollectionBehavior:", None, (ctypes.c_ulong,), (behavior | (1 << 0) | (1 << 8),))
        self.objc.send(window, "setHidesOnDeactivate:", None, (ctypes.c_bool,), (False,))
        self.objc.send(window, "setHasShadow:", None, (ctypes.c_bool,), (False,))

    def activate(self) -> None:
        application = self.objc.send(self.objc.cls("NSApplication"), "sharedApplication")
        if self.objc.responds(application, "activate"):
            self.objc.send(application, "activate", None)
        else:
            self.objc.send(application, "activateIgnoringOtherApps:", None, (ctypes.c_bool,), (True,))


class _WindowsFilter(QAbstractNativeEventFilter):
    def __init__(self, backend) -> None:
        super().__init__()
        self.backend = backend

    def nativeEventFilter(self, event_type, message):
        if bytes(event_type) in (b"windows_generic_MSG", b"windows_dispatcher_MSG"):
            event = self.backend.wintypes.MSG.from_address(int(message))
            if event.message == 0x0312 and event.wParam == self.backend.current_id:
                self.backend.owner._nativeActivated.emit()
                return True, 0
        return False, 0


@dataclass(frozen=True)
class _WindowsForeground:
    handle: int
    pid: int


class _WindowsBackend:
    def __init__(self, owner: "DesktopIntegration") -> None:
        from ctypes import wintypes

        self.owner, self.wintypes = owner, wintypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
        self.user32.RegisterHotKey.restype = wintypes.BOOL
        self.user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
        self.user32.UnregisterHotKey.restype = wintypes.BOOL
        self.user32.GetForegroundWindow.argtypes = []
        self.user32.GetForegroundWindow.restype = wintypes.HWND
        self.user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        self.user32.SetForegroundWindow.restype = wintypes.BOOL
        self.user32.IsWindow.argtypes = [wintypes.HWND]
        self.user32.IsWindow.restype = wintypes.BOOL
        self.user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self.user32.GetWindowThreadProcessId.restype = wintypes.DWORD
        self.current_id = None
        self._binding = None
        self._ids: set[int] = set()
        self._filter = _WindowsFilter(self)
        self._application = QCoreApplication.instance()
        if self._application is None:
            raise RuntimeError("QApplication을 먼저 생성해야 합니다.")
        self._application.installNativeEventFilter(self._filter)

    def register(self, binding) -> tuple[bool, str]:
        if binding == self._binding:
            return True, ""
        key, ctrl, shift, alt, meta = binding
        if key not in _WIN_KEYS or key == "F12":
            return False, f"Windows에서 지원하지 않거나 예약된 전역 키입니다: {key}"
        identifier = next(_HOTKEY_IDS)
        if identifier > 0xBFFF:
            return False, "전역 단축키 식별자를 모두 사용했습니다. 앱을 다시 시작하세요."
        modifiers = (2 if ctrl else 0) | (4 if shift else 0) | (1 if alt else 0) | (8 if meta else 0) | 0x4000
        if not self.user32.RegisterHotKey(None, identifier, modifiers, _WIN_KEYS[key]):
            return False, f"전역 단축키 등록 실패. 다른 앱·시스템 단축키와의 충돌을 확인하세요. (WinError {ctypes.get_last_error()})"
        self._ids.add(identifier)
        previous = self.current_id
        if previous is not None:
            if not self.user32.UnregisterHotKey(None, previous):
                error = ctypes.get_last_error()
                if self.user32.UnregisterHotKey(None, identifier):
                    self._ids.remove(identifier)
                return False, f"이전 전역 단축키 해제 실패 (WinError {error})"
            self._ids.remove(previous)
        self.current_id, self._binding = identifier, binding
        return True, ""

    def close(self) -> None:
        self.current_id = None
        for identifier in self._ids:
            self.user32.UnregisterHotKey(None, identifier)
        self._ids.clear()
        self._application.removeNativeEventFilter(self._filter)

    def foreground(self):
        handle = self.user32.GetForegroundWindow()
        if not handle:
            return None
        pid = self.wintypes.DWORD()
        self.user32.GetWindowThreadProcessId(handle, ctypes.byref(pid))
        return None if pid.value == os.getpid() else _WindowsForeground(int(handle), pid.value)

    def restore(self, token) -> bool:
        if not isinstance(token, _WindowsForeground) or not self.user32.IsWindow(token.handle):
            return False
        pid = self.wintypes.DWORD()
        self.user32.GetWindowThreadProcessId(token.handle, ctypes.byref(pid))
        return pid.value == token.pid and bool(self.user32.SetForegroundWindow(token.handle))

    def configure(self, widget) -> None:
        # Frameless/translucent/topmost flags are owned by the Qt window itself.
        widget.winId()

    def activate(self) -> None:
        # Qt activateWindow()/raise_() select the app's actual overlay window.
        pass


class DesktopIntegration(QObject):
    hotkeyActivated = Signal()
    _nativeActivated = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        from PySide6.QtCore import Qt

        self._backend = None
        self._initialization_error = ""
        self._closed = False
        self._nativeActivated.connect(self._dispatch_hotkey, Qt.ConnectionType.QueuedConnection)
        try:
            if sys.platform == "darwin":
                self._backend = _MacBackend(self)
            elif sys.platform == "win32":
                self._backend = _WindowsBackend(self)
            else:
                self._initialization_error = "현재 운영체제는 전역 단축키를 지원하지 않습니다. macOS 또는 Windows에서 실행하세요."
        except (OSError, AttributeError, RuntimeError) as error:
            self._initialization_error = f"데스크톱 연동 초기화 실패: {error}"

    def _dispatch_hotkey(self) -> None:
        if not self._closed:
            self.hotkeyActivated.emit()

    def register_hotkey(self, binding: dict) -> tuple[bool, str]:
        if self._closed:
            return False, "데스크톱 연동이 종료되었습니다."
        if self._backend is None:
            return False, self._initialization_error
        try:
            return self._backend.register(_normalize_binding(binding))
        except (ValueError, OSError, RuntimeError) as error:
            return False, str(error)

    def foreground_app(self):
        return self._backend.foreground() if self._backend is not None and not self._closed else None

    def restore_foreground(self, token) -> bool:
        return bool(self._backend.restore(token)) if self._backend is not None and not self._closed else False

    def configure_overlay(self, widget) -> None:
        if self._backend is None:
            raise RuntimeError(self._initialization_error)
        self._backend.configure(widget)

    def activate_app(self) -> None:
        if self._backend is not None and not self._closed:
            self._backend.activate()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._backend is not None:
            self._backend.close()
