"""Validated preferences and physical keyboard bindings."""

import copy
import json
import os
import sys
from pathlib import Path

from PySide6.QtCore import QStandardPaths, Qt


ACTIONS = (
    ("toggle", "필기 켜기 / 끄기"),
    ("pen", "펜"),
    ("rect", "사각형"),
    ("text", "텍스트"),
    ("increase", "선 굵기 증가"),
    ("decrease", "선 굵기 감소"),
    ("settings", "단축키 설정"),
)
PALETTE = ("#334A42", "#E26159", "#E8A04F", "#E4C65B", "#7AA675", "#628EBE", "#9D83B7", "#FFFFFF")


def binding(key, ctrl=False, shift=False, alt=False, meta=False):
    return dict(key=key, ctrl=ctrl, shift=shift, alt=alt, meta=meta)


DEFAULT_SHORTCUTS = dict(
    toggle=binding("Tab", ctrl=True, meta=True) if sys.platform == "darwin" else binding("Space", ctrl=True, shift=True),
    pen=binding("B"), rect=binding("R"), text=binding("T"),
    increase=binding("BracketRight"), decrease=binding("BracketLeft"),
    settings=binding("Comma", ctrl=True),
)
SPECIAL_KEYS = {
    Qt.Key.Key_Tab: "Tab", Qt.Key.Key_Space: "Space", Qt.Key.Key_Comma: "Comma",
    Qt.Key.Key_BracketLeft: "BracketLeft", Qt.Key.Key_BracketRight: "BracketRight",
    Qt.Key.Key_Period: "Period", Qt.Key.Key_Slash: "Slash", Qt.Key.Key_Backslash: "Backslash",
    Qt.Key.Key_Minus: "Minus", Qt.Key.Key_Equal: "Equal", Qt.Key.Key_Semicolon: "Semicolon",
    Qt.Key.Key_Apostrophe: "Quote", Qt.Key.Key_QuoteLeft: "Backquote",
}
MAC_KEYS = {
    0:"A", 1:"S", 2:"D", 3:"F", 4:"H", 5:"G", 6:"Z", 7:"X", 8:"C", 9:"V",
    11:"B", 12:"Q", 13:"W", 14:"E", 15:"R", 16:"Y", 17:"T",
    18:"1", 19:"2", 20:"3", 21:"4", 22:"6", 23:"5", 24:"Equal", 25:"9",
    26:"7", 27:"Minus", 28:"8", 29:"0", 30:"BracketRight", 31:"O", 32:"U",
    33:"BracketLeft", 34:"I", 35:"P", 37:"L", 38:"J", 39:"Quote", 40:"K",
    41:"Semicolon", 42:"Backslash", 43:"Comma", 44:"Slash", 45:"N", 46:"M",
    47:"Period", 48:"Tab", 49:"Space", 50:"Backquote",
}
WIN_KEYS = {
    **{value: chr(value) for value in range(ord("A"), ord("Z") + 1)},
    **{value: chr(value) for value in range(ord("0"), ord("9") + 1)},
    **{0x70+i: f"F{i+1}" for i in range(12)},
    0x09:"Tab", 0x20:"Space", 0xBC:"Comma", 0xBE:"Period", 0xBF:"Slash", 0xDC:"Backslash",
    0xBD:"Minus", 0xBB:"Equal", 0xBA:"Semicolon", 0xDE:"Quote", 0xC0:"Backquote",
    0xDB:"BracketLeft", 0xDD:"BracketRight",
}
WIN_SCANS = {
    **dict(zip(range(0x10, 0x1A), "QWERTYUIOP")),
    **dict(zip(range(0x1E, 0x27), "ASDFGHJKL")),
    **dict(zip(range(0x2C, 0x33), "ZXCVBNM")),
    **dict(zip(range(0x02, 0x0C), "1234567890")),
    0x0F:"Tab", 0x0C:"Minus", 0x0D:"Equal", 0x1A:"BracketLeft", 0x1B:"BracketRight",
    0x27:"Semicolon", 0x28:"Quote", 0x29:"Backquote", 0x2B:"Backslash",
    0x33:"Comma", 0x34:"Period", 0x35:"Slash", 0x39:"Space",
}


def physical_modifiers(modifiers):
    control, command = Qt.KeyboardModifier.ControlModifier, Qt.KeyboardModifier.MetaModifier
    if sys.platform == "darwin":
        control, command = command, control
    return dict(ctrl=bool(modifiers & control), shift=bool(modifiers & Qt.KeyboardModifier.ShiftModifier),
                alt=bool(modifiers & Qt.KeyboardModifier.AltModifier), meta=bool(modifiers & command))


def event_binding(event):
    if event.key() in (Qt.Key.Key_Shift, Qt.Key.Key_Control, Qt.Key.Key_Meta, Qt.Key.Key_Alt,
                       Qt.Key.Key_AltGr, Qt.Key.Key_CapsLock, Qt.Key.Key_NumLock,
                       Qt.Key.Key_ScrollLock, Qt.Key.Key_Escape, Qt.Key.Key_Return, Qt.Key.Key_Enter):
        return None
    key = None
    # Real macOS key events carry the hardware virtual key even with a Korean layout.
    # QtTest events have no native fields and use the portable Qt key fallback.
    if sys.platform == "darwin" and (event.nativeScanCode() or event.nativeVirtualKey() or event.nativeModifiers()):
        key = MAC_KEYS.get(event.nativeVirtualKey())
    elif sys.platform == "win32":
        key = WIN_SCANS.get(event.nativeScanCode()) or WIN_KEYS.get(event.nativeVirtualKey())
    if key is None:
        value = event.key()
        if Qt.Key.Key_A <= value <= Qt.Key.Key_Z or Qt.Key.Key_0 <= value <= Qt.Key.Key_9:
            key = chr(value)
        elif Qt.Key.Key_F1 <= value <= Qt.Key.Key_F12:
            key = f"F{value - Qt.Key.Key_F1 + 1}"
        else:
            key = SPECIAL_KEYS.get(value)
    return binding(key, **physical_modifiers(event.modifiers())) if key else None


def binding_label(value):
    names = {"Comma": ",", "BracketLeft": "[", "BracketRight": "]", "Period": ".",
             "Slash": "/", "Backslash": "\\", "Minus": "-", "Equal": "=",
             "Semicolon": ";", "Quote": "'", "Backquote": "`"}
    return "+".join([name for flag, name in (("ctrl", "Ctrl"), ("shift", "Shift"),
                     ("alt", "Alt"), ("meta", "Cmd" if sys.platform == "darwin" else "Win"))
                     if value.get(flag)] + [names.get(value["key"], value["key"])])


def signature(value):
    return (value.get("key"), *(bool(value.get(k)) for k in ("ctrl", "shift", "alt", "meta")))


def validate_shortcuts(shortcuts):
    allowed = set(MAC_KEYS.values()) | {f"F{i}" for i in range(1, 13)}
    seen = {}
    for action, label in ACTIONS:
        value = shortcuts.get(action)
        if not isinstance(value, dict) or value.get("key") not in allowed:
            return f"{label}: 문자·숫자·기호·Tab·F1~F12 중에서 지정하세요. Enter와 Esc는 고정 입력입니다."
        if any(not isinstance(value.get(k, False), bool) for k in ("ctrl", "shift", "alt", "meta")):
            return f"{label}: 잘못된 보조키 설정입니다."
        if action == "toggle" and not any(value.get(k) for k in ("ctrl", "alt", "meta")):
            return "전역 토글에는 Ctrl, Alt, Cmd/Win 중 하나를 함께 지정하세요."
        sig = signature(value)
        if sig in seen:
            return f"'{seen[sig]}'·'{label}'의 키가 같습니다."
        seen[sig] = label
    return ""


class Preferences:
    def __init__(self, path=None):
        self.path = Path(path) if path else Path(QStandardPaths.writableLocation(
            QStandardPaths.StandardLocation.AppConfigLocation)) / "preferences.json"
        self.color, self.width, self.font_size = PALETTE[0], 4, 28
        self.shortcuts = copy.deepcopy(DEFAULT_SHORTCUTS)
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            color = raw.get("color", "")
            if len(color) == 7 and color.startswith("#") and all(c in "0123456789abcdefABCDEF" for c in color[1:]):
                self.color = color.upper()
            self.width = min(32, max(1, int(raw.get("width", 4))))
            self.font_size = min(144, max(12, int(raw.get("font_size", 28))))
            if isinstance(raw.get("shortcuts"), dict) and not validate_shortcuts(raw["shortcuts"]):
                self.shortcuts = {a: binding(**raw["shortcuts"][a]) for a, _ in ACTIONS}
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(dict(color=self.color, width=self.width, font_size=self.font_size,
                                            shortcuts=self.shortcuts), ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)
