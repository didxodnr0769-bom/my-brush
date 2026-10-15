"""Transparent native Qt overlays. No browser, web view, or local web server."""

from __future__ import annotations

import copy
import ctypes
import json
import os
import sys
import time
import uuid
from dataclasses import replace

from PySide6.QtCore import QEvent, QObject, QPointF, QRectF, QSize, Qt, QTimer, Signal
from PySide6.QtGui import (QAction, QColor, QCursor, QFont, QFontMetricsF, QIcon,
                          QPainter, QPainterPath, QPen, QPixmap)
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtWidgets import (QAbstractSpinBox, QApplication, QColorDialog, QDialog,
    QDialogButtonBox, QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QMenu,
    QMessageBox, QPlainTextEdit, QPushButton, QSlider, QSpinBox, QSystemTrayIcon,
    QVBoxLayout, QWidget)

from .model import Rectangle, Scene, Stroke, Text, intersects, normalized_rect, valid_delete_drag
from .platform import DesktopIntegration
from .preferences import (ACTIONS, PALETTE, Preferences, binding_label, event_binding,
                          physical_modifiers, signature, validate_shortcuts)


def trace_event(name, **values):
    """Opt-in development trace; no text contents or global keyboard monitoring."""
    path = os.environ.get("MY_BRUSH_TRACE_PATH")
    if path:
        try:
            with open(path, "a", encoding="utf-8") as stream:
                stream.write(json.dumps(dict(time=time.monotonic(), event=name, **values)) + "\n")
        except OSError:
            pass


def text_font(size):
    font = QFont()
    font.setPixelSize(size)
    return font


def text_bounds(obj):
    metrics = QFontMetricsF(text_font(obj.font_size))
    lines = obj.text.split("\n")
    return (obj.x, obj.y, max(1, *(metrics.horizontalAdvance(line) for line in lines)),
            max(1, len(lines)) * max(metrics.height(), obj.font_size * 1.35))


def app_icon():
    pixmap = QPixmap(64, 64)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setBrush(QColor("#405C4D"))
    painter.setPen(Qt.PenStyle.NoPen)
    painter.drawRoundedRect(QRectF(2, 2, 60, 60), 15, 15)
    painter.setPen(QPen(QColor("white"), 5, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
    painter.drawLine(QPointF(19, 44), QPointF(43, 20))
    painter.drawLine(QPointF(18, 46), QPointF(28, 43))
    painter.end()
    return QIcon(pixmap)


def native_left_button_down():
    """Disambiguate macOS Control-left-click from a real right click."""
    if sys.platform != "darwin":
        return False
    try:
        lib = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        function = lib.CGEventSourceButtonState
        function.argtypes = [ctypes.c_int32, ctypes.c_uint32]
        function.restype = ctypes.c_bool
        return bool(function(0, 0))
    except (OSError, AttributeError):
        return False


class TextEditor(QPlainTextEdit):
    commitRequested = Signal()
    cancelRequested = Signal()

    def __init__(self, parent):
        super().__init__(parent)
        self.composing = False
        self.last_composition_end = 0.0
        self.setObjectName("textEditor")
        self.setAccessibleName("화면 텍스트 편집")
        self.setPlaceholderText("텍스트 입력")
        self.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setStyleSheet("QPlainTextEdit#textEditor {background:rgba(255,255,255,245); border:1px solid #8DAA89; padding:2px;}")
        self.document().setDocumentMargin(2)
        self.hide()

    def inputMethodEvent(self, event):
        self.composing = bool(event.preeditString())
        if not self.composing:
            self.last_composition_end = time.monotonic()
        super().inputMethodEvent(event)

    def keyPressEvent(self, event):
        if self.composing or time.monotonic() - self.last_composition_end < .03:
            super().keyPressEvent(event)
            return
        if event.key() == Qt.Key.Key_Escape:
            self.cancelRequested.emit()
            event.accept()
        elif event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter) and physical_modifiers(event.modifiers())["ctrl"]:
            self.commitRequested.emit()
            event.accept()
        else:
            super().keyPressEvent(event)


class ShortcutDialog(QDialog):
    def __init__(self, controller, parent):
        super().__init__(parent)
        self.controller = controller
        self.values = copy.deepcopy(controller.prefs.shortcuts)
        self.recording = None
        self.buttons = {}
        self.setWindowTitle("My Brush · 단축키 설정")
        self.setMinimumWidth(420)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 22)
        layout.addWidget(QLabel("바꿀 동작의 키 버튼을 누르고 새 조합을 입력하세요."))
        grid = QGridLayout()
        for row, (action, label) in enumerate(ACTIONS):
            grid.addWidget(QLabel(label), row, 0)
            button = QPushButton(binding_label(self.values[action]))
            button.setAccessibleName(label + " 단축키")
            button.setMinimumWidth(165)
            button.installEventFilter(self)
            button.clicked.connect(lambda checked=False, name=action: self.start_recording(name))
            self.buttons[action] = button
            grid.addWidget(button, row, 1)
        layout.addLayout(grid)
        fixed = QLabel("Ctrl+드래그: 영역 삭제 (고정)\nEnter: 줄바꿈 · Ctrl+Enter: 텍스트 완료 · Esc: 취소")
        fixed.setStyleSheet("color:#6C7D6D; padding:12px 0;")
        layout.addWidget(fixed)
        self.message = QLabel("전역 조합의 OS 점유 여부는 저장 시 실제 등록으로 확인합니다.")
        self.message.setWordWrap(True)
        self.message.setMinimumHeight(42)
        layout.addWidget(self.message)
        box = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
        self.save_button = box.button(QDialogButtonBox.StandardButton.Save)
        self.save_button.setText("저장")
        box.button(QDialogButtonBox.StandardButton.Cancel).setText("취소")
        box.accepted.connect(self.save)
        box.rejected.connect(self.reject)
        layout.addWidget(box)

    def start_recording(self, action):
        if self.recording:
            self.buttons[self.recording].setText(binding_label(self.values[self.recording]))
        self.recording = action
        self.buttons[action].setText("새 조합을 누르세요…")
        self.buttons[action].setFocus()
        self.save_button.setEnabled(False)
        self.message.setText("보조키와 함께 원하는 키를 누르세요. Esc는 기록만 취소합니다.")

    def eventFilter(self, watched, event):
        if event.type() == QEvent.Type.KeyPress and self.recording:
            if event.isAutoRepeat():
                return True
            action = self.recording
            if event.key() == Qt.Key.Key_Escape:
                self.recording = None
                self.buttons[action].setText(binding_label(self.values[action]))
            else:
                value = event_binding(event)
                if not value:
                    self.message.setText("문자·숫자·기호·Tab·F1~F12를 사용하세요. 보조키 단독·Enter·Esc는 지정할 수 없습니다.")
                    return True
                self.record_binding(value)
                return True
            error = validate_shortcuts(self.values)
            self.message.setText(error or "저장하면 적용됩니다.")
            self.save_button.setEnabled(not error)
            return True
        return super().eventFilter(watched, event)

    def record_binding(self, value):
        if not self.recording:
            return
        action, self.recording = self.recording, None
        self.values[action] = copy.deepcopy(value)
        self.buttons[action].setText(binding_label(value))
        error = validate_shortcuts(self.values)
        self.message.setText(error or "저장하면 적용됩니다.")
        self.save_button.setEnabled(not error)

    def save(self):
        error = validate_shortcuts(self.values)
        if error:
            self.message.setText(error)
            return
        success, message = self.controller.apply_shortcuts(self.values)
        if success:
            self.accept()
        else:
            self.message.setText(message)


class Toolbar(QFrame):
    def __init__(self, overlay):
        super().__init__(overlay)
        self.overlay = overlay
        self.controller = overlay.controller
        self.setObjectName("toolbar")
        self.setStyleSheet("""
            QFrame#toolbar {background:#FAFCF8; border:1px solid #CCD8CB; border-radius:12px;}
            QFrame#toolbar QPushButton {padding:7px 9px; border:0; border-radius:6px; color:#405C4D;}
            QFrame#toolbar QPushButton:hover {background:#E7EEE4;}
            QFrame#toolbar QPushButton:checked {background:#405C4D; color:white;}
            QFrame#toolbar QLabel {color:#65765F; font-size:11px;}
        """)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 8, 10, 8)
        layout.setSpacing(5)
        self.tool_buttons = {}
        for action, label in (("pen", "펜"), ("rect", "사각형"), ("text", "텍스트")):
            button = QPushButton(label)
            button.setCheckable(True)
            button.setAutoExclusive(True)
            button.setAccessibleName(label)
            button.toggled.connect(lambda checked, name=action: self.controller.select_tool(name) if checked else None)
            self.tool_buttons[action] = button
            layout.addWidget(button)
        self.color_buttons = []
        for color in PALETTE:
            button = QPushButton()
            button.setFixedSize(22, 24)
            button.setAccessibleName("색상 " + color)
            button.setToolTip(color)
            button.setStyleSheet(f"QPushButton {{background:{color};border:1px solid #BDCCBC;border-radius:9px;padding:0;}}")
            button.clicked.connect(lambda checked=False, value=color: self.controller.set_color(value))
            self.color_buttons.append((color, button))
            layout.addWidget(button)
        custom = QPushButton("+")
        custom.setAccessibleName("직접 색상 선택")
        custom.clicked.connect(self.choose_color)
        layout.addWidget(custom)
        layout.addWidget(QLabel("굵기"))
        self.width_slider = QSlider(Qt.Orientation.Horizontal)
        self.width_slider.setAccessibleName("선 굵기")
        self.width_slider.setRange(1, 32)
        self.width_slider.setFixedWidth(74)
        self.width_slider.valueChanged.connect(self.controller.set_width)
        layout.addWidget(self.width_slider)
        self.width_value = QLabel()
        self.width_value.setFixedWidth(20)
        layout.addWidget(self.width_value)
        self.font_label = QLabel("글자")
        layout.addWidget(self.font_label)
        self.font_size = QSpinBox()
        self.font_size.setAccessibleName("텍스트 크기")
        self.font_size.setRange(12, 144)
        self.font_size.setKeyboardTracking(False)
        self.font_size.setFixedWidth(65)
        self.font_size.valueChanged.connect(self.controller.set_font_size)
        layout.addWidget(self.font_size)
        self.settings = QPushButton("단축키")
        self.settings.setAccessibleName("단축키 설정")
        self.settings.clicked.connect(self.controller.open_settings)
        layout.addWidget(self.settings)
        self.return_button = QPushButton("필기 끄기")
        self.return_button.clicked.connect(self.controller.hide)
        layout.addWidget(self.return_button)
        self.refresh()

    def choose_color(self):
        color = QColorDialog.getColor(QColor(self.controller.prefs.color), self, "필기 색상")
        if color.isValid():
            self.controller.set_color(color.name().upper())

    def refresh(self):
        controller, prefs = self.controller, self.controller.prefs
        for action, button in self.tool_buttons.items():
            button.blockSignals(True)
            button.setChecked(controller.tool == action)
            button.blockSignals(False)
            button.setToolTip(binding_label(prefs.shortcuts[action]))
        for color, button in self.color_buttons:
            button.setText("•" if color.upper() == prefs.color.upper() else "")
        self.width_slider.blockSignals(True)
        self.width_slider.setValue(prefs.width)
        self.width_slider.blockSignals(False)
        self.width_value.setText(str(prefs.width))
        self.font_size.blockSignals(True)
        self.font_size.setValue(self.overlay.draft.font_size if self.overlay.draft else prefs.font_size)
        self.font_size.blockSignals(False)
        self.font_size.setVisible(controller.tool == "text")
        self.font_label.setVisible(controller.tool == "text")
        self.settings.setToolTip(binding_label(prefs.shortcuts["settings"]))
        self.return_button.setToolTip(binding_label(prefs.shortcuts["toggle"]))
        self.adjustSize()


class Overlay(QWidget):
    def __init__(self, controller, screen, scene=None):
        super().__init__(None, Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint | Qt.WindowType.Window)
        self.controller, self.screen = controller, screen
        self.scene = scene or Scene()
        self.gesture = None
        self.draft = None
        self.original_text = None
        self.setWindowTitle("My Brush · 화면 필기")
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_MacAlwaysShowToolWindow)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setMouseTracking(True)
        self.setCursor(Qt.CursorShape.CrossCursor)
        self.setGeometry(screen.geometry())
        self.editor = TextEditor(self)
        self.editor.textChanged.connect(self.resize_editor)
        self.editor.commitRequested.connect(self.commit_text)
        self.editor.cancelRequested.connect(self.cancel_text)
        self.toolbar = Toolbar(self)
        self.status = QLabel(self)
        self.status.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.status.setStyleSheet("background:rgba(250,252,248,240);color:#405C4D;border:1px solid #CDD8C9;border-radius:8px;padding:6px 12px;")
        self.refresh()
        screen.geometryChanged.connect(self.screen_geometry_changed)

    def screen_geometry_changed(self, geometry):
        self.cancel_gesture()
        self.setGeometry(geometry)

    def resizeEvent(self, event):
        self.place_controls()
        super().resizeEvent(event)

    def place_controls(self):
        if not hasattr(self, "toolbar"):
            return
        self.toolbar.move(max(8, (self.width()-self.toolbar.width())//2), 40)
        self.status.adjustSize()
        self.status.move(max(8, (self.width()-self.status.width())//2), max(0, self.height()-60))

    def refresh(self):
        self.toolbar.refresh()
        self.setCursor(Qt.CursorShape.IBeamCursor if self.controller.tool == "text" else Qt.CursorShape.CrossCursor)
        if not self.controller.hotkey_registered:
            message = "전역 단축키 등록 실패 · 메뉴 막대/트레이에서 필기 시작 가능"
        elif self.gesture and self.gesture["type"] == "delete":
            message = f"영역 삭제 · {len(self.deletion_targets())}개 대상 · Ctrl을 먼저 놓으면 취소"
        elif self.draft:
            message = "텍스트 입력 · Ctrl+Enter 완료 · Esc 취소"
        else:
            message = ({"pen":"펜", "rect":"사각형", "text":"텍스트"}[self.controller.tool]
                       + " · Ctrl+드래그로 영역 삭제 · "
                       + binding_label(self.controller.prefs.shortcuts["toggle"]) + " 켜기/끄기 · Esc 필기 끄기")
        self.status.setText(message)
        self.status.setToolTip(self.controller.registration_error)
        self.place_controls()
        self.update()

    def deletion_targets(self):
        if not self.gesture or self.gesture["type"] != "delete":
            return set()
        start, end = self.gesture["start"], self.gesture["current"]
        if not valid_delete_drag(start, end):
            return set()
        area = normalized_rect(start, end)
        return {obj.id for obj in self.scene.objects if intersects(obj, area, text_bounds)}

    def paint_object(self, painter, obj, highlighted=False):
        color = QColor("#D36554" if highlighted else obj.color)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        if isinstance(obj, Text):
            font = text_font(obj.font_size)
            metrics = QFontMetricsF(font)
            painter.setFont(font)
            painter.setPen(color)
            line_height = max(metrics.height(), obj.font_size * 1.35)
            for index, line in enumerate(obj.text.split("\n")):
                painter.drawText(QPointF(obj.x, obj.y+metrics.ascent()+index*line_height), line)
            if highlighted:
                painter.setPen(QPen(color, 1, Qt.PenStyle.DashLine))
                painter.drawRect(QRectF(*text_bounds(obj)))
        else:
            width = obj.width if isinstance(obj, Stroke) else obj.line_width
            painter.setPen(QPen(color, width, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
            if isinstance(obj, Rectangle):
                painter.drawRect(QRectF(obj.x, obj.y, obj.width, obj.height))
            elif len(obj.points) == 1:
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(color)
                painter.drawEllipse(QPointF(*obj.points[0]), width/2, width/2)
            elif obj.points:
                path = QPainterPath(QPointF(*obj.points[0]))
                for point in obj.points[1:]:
                    path.lineTo(QPointF(*point))
                painter.drawPath(path)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_Source)
        # Alpha 1 keeps blank pixels input-active on Windows layered windows.
        painter.fillRect(self.rect(), QColor(0, 0, 0, 1))
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceOver)
        targets = self.deletion_targets()
        for obj in self.scene.objects:
            if self.original_text and obj.id == self.original_text.id:
                continue
            self.paint_object(painter, obj, obj.id in targets)
        if self.gesture:
            g = self.gesture
            if g["type"] == "pen":
                self.paint_object(painter, Stroke("preview", g["points"], g["color"], g["width"]))
            elif g["type"] == "rect":
                self.paint_object(painter, Rectangle("preview", *normalized_rect(g["start"],g["current"]), g["color"], g["width"]))
            else:
                painter.setPen(QPen(QColor("#CF725F"), 1, Qt.PenStyle.DashLine))
                painter.setBrush(QColor(211, 112, 88, 30))
                painter.drawRect(QRectF(*normalized_rect(g["start"],g["current"])))

    def mousePressEvent(self, event):
        control = physical_modifiers(event.modifiers())["ctrl"]
        trace_event("pointer_press", button=event.button().value, control=control)
        primary = event.button() == Qt.MouseButton.LeftButton or (
            sys.platform == "darwin" and control and native_left_button_down())
        if not primary or self.gesture:
            return
        self.setFocus(Qt.FocusReason.MouseFocusReason)
        if self.draft:
            self.commit_text()
            event.accept()
            return
        point = (event.position().x(), event.position().y())
        if not control and self.controller.tool == "text":
            self.begin_text(point, self.scene.find_text(point, text_bounds))
            event.accept()
            return
        prefs = self.controller.prefs
        self.gesture = dict(type="delete" if control else self.controller.tool, start=point, current=point,
                            points=[point], color=prefs.color, width=prefs.width, button=event.button())
        self.grabMouse()
        self.refresh()
        event.accept()

    def mouseMoveEvent(self, event):
        if not self.gesture:
            return
        if self.gesture["type"] == "delete" and not physical_modifiers(event.modifiers())["ctrl"]:
            self.cancel_gesture()
            return
        point = (event.position().x(), event.position().y())
        self.gesture["current"] = point
        if self.gesture["type"] == "pen" and self.gesture["points"][-1] != point:
            self.gesture["points"].append(point)
        self.refresh()
        event.accept()

    def mouseReleaseEvent(self, event):
        if not self.gesture:
            return
        if event.button() != self.gesture["button"]:
            return
        g = self.gesture
        point = (event.position().x(), event.position().y())
        g["current"] = point
        if g["type"] == "delete":
            if physical_modifiers(event.modifiers())["ctrl"] and valid_delete_drag(g["start"], point):
                self.scene.remove_intersecting(normalized_rect(g["start"],point), text_bounds)
        elif g["type"] == "pen":
            if g["points"][-1] != point:
                g["points"].append(point)
            self.scene.add(Stroke(uuid.uuid4().hex, g["points"],g["color"],g["width"]))
        else:
            rect = normalized_rect(g["start"],point)
            if rect[2] and rect[3]:
                self.scene.add(Rectangle(uuid.uuid4().hex, *rect,g["color"],g["width"]))
        self.cancel_gesture()
        event.accept()

    def contextMenuEvent(self, event):
        event.accept()

    def event(self, event):
        if event.type() in (QEvent.Type.WindowDeactivate, QEvent.Type.UngrabMouse) and getattr(self, "gesture", None):
            self.cancel_gesture()
        return super().event(event)

    def cancel_gesture(self):
        self.gesture = None
        if QWidget.mouseGrabber() is self:
            self.releaseMouse()
        self.refresh()

    def begin_text(self, point, existing=None):
        for overlay in self.controller.overlays:
            if overlay is not self:
                overlay.commit_text()
        self.original_text = existing
        self.draft = replace(existing) if existing else Text(uuid.uuid4().hex, *point, "",
                         self.controller.prefs.color, self.controller.prefs.font_size)
        self.editor.setPlainText(self.draft.text)
        self.style_editor()
        self.editor.show()
        self.editor.raise_()
        self.toolbar.raise_()
        self.editor.setFocus()
        self.refresh()

    def style_editor(self):
        if not self.draft:
            return
        self.editor.setFont(text_font(self.draft.font_size))
        palette = self.editor.palette()
        palette.setColor(palette.ColorRole.Text, QColor(self.draft.color))
        self.editor.setPalette(palette)
        self.resize_editor()

    def resize_editor(self):
        if not self.draft:
            return
        self.draft.text = self.editor.toPlainText()
        bounds = text_bounds(self.draft)
        x, y = int(min(self.draft.x, self.width()-125)), int(min(self.draft.y, self.height()-65))
        width = int(min(max(120, bounds[2]+25), max(120, self.width()-x-8)))
        height = int(min(max(55, bounds[3]+14), max(55, self.height()-y-8)))
        self.editor.setGeometry(max(0,x-4),max(0,y-4),width,height)
        self.update()

    def commit_text(self):
        if not self.draft:
            return
        QApplication.inputMethod().commit()
        self.draft.text = self.editor.toPlainText()
        if self.original_text:
            index = self.scene.objects.index(self.original_text)
            if self.draft.text.strip():
                self.scene.objects[index] = self.draft
            else:
                self.scene.objects.pop(index)
        elif self.draft.text.strip():
            self.scene.add(self.draft)
        self.finish_editor()

    def cancel_text(self):
        QApplication.inputMethod().reset()
        self.finish_editor()

    def finish_editor(self):
        self.draft = self.original_text = None
        self.editor.composing = False
        self.editor.hide()
        self.setFocus()
        self.refresh()

    def closeEvent(self, event):
        event.ignore()
        self.controller.hide()


class Controller(QObject):
    def __init__(self, app, preferences=None, integration=None):
        super().__init__(app)
        self.app = app
        self.prefs = preferences or Preferences()
        self.integration = integration or DesktopIntegration(self)
        self.tool, self.visible = "pen", False
        self.overlays = []
        self.scenes = {}
        self.previous_app = None
        self.dialog = None
        self.hotkey_registered = False
        self.registration_error = ""
        self.integration.hotkeyActivated.connect(self.native_toggle)
        self.hotkey_registered, self.registration_error = self.integration.register_hotkey(self.prefs.shortcuts["toggle"])
        self.tray = QSystemTrayIcon(app_icon(), self)
        self.tray.setToolTip("My Brush")
        menu = QMenu()
        self.toggle_action = menu.addAction("필기 켜기", self.toggle)
        menu.addAction("단축키 설정…", self.open_settings)
        menu.addSeparator()
        menu.addAction("My Brush 종료", app.quit)
        self.tray_menu = menu
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(lambda reason: self.toggle() if reason == QSystemTrayIcon.ActivationReason.DoubleClick else None)
        self.tray.show()
        self.rebuild_screens()
        self.refresh()
        app.screenAdded.connect(lambda screen: self.rebuild_screens())
        app.screenRemoved.connect(lambda screen: self.rebuild_screens())
        app.applicationStateChanged.connect(self.application_state_changed)
        app.aboutToQuit.connect(self.integration.close)
        app.installEventFilter(self)

    def rebuild_screens(self):
        was_visible = self.visible
        for overlay in self.overlays:
            overlay.commit_text()
            overlay.cancel_gesture()
            overlay.hide()
            overlay.deleteLater()
        self.overlays = []
        for screen in self.app.screens():
            name = screen.name()
            scene = self.scenes.setdefault(name, Scene())
            self.overlays.append(Overlay(self, screen, scene))
        if was_visible:
            self.show(capture_foreground=False)

    def active_overlay(self):
        screen = self.app.screenAt(QCursor.pos()) or self.app.primaryScreen()
        return next((o for o in self.overlays if o.screen is screen), self.overlays[0])

    def show(self, capture_foreground=True):
        trace_event("show", visible=self.visible)
        if capture_foreground and not self.visible:
            previous = self.integration.foreground_app()
            if previous is not None:
                self.previous_app = previous
        self.visible = True
        active = self.active_overlay()
        for overlay in self.overlays:
            overlay.show()
            self.integration.configure_overlay(overlay)
            overlay.toolbar.setVisible(overlay is active)
            overlay.status.setVisible(overlay is active)
        self.refresh()
        self.integration.activate_app()
        active.raise_()
        active.activateWindow()
        active.setFocus()

    def hide(self):
        trace_event("hide", visible=self.visible)
        was_visible, self.visible = self.visible, False
        if self.dialog:
            self.dialog.reject()
        for overlay in self.overlays:
            overlay.cancel_gesture()
            overlay.commit_text()
            overlay.hide()
        self.refresh()
        if was_visible and self.previous_app:
            self.integration.restore_foreground(self.previous_app)

    def toggle(self):
        trace_event("toggle", visible=self.visible, modal=bool(QApplication.activeModalWidget()))
        if self.dialog:
            if self.dialog.recording:
                self.dialog.record_binding(self.prefs.shortcuts["toggle"])
            return
        if QApplication.activeModalWidget():
            return
        if any(o.editor.composing for o in self.overlays):
            return
        self.hide() if self.visible else self.show()

    def native_toggle(self):
        trace_event("native_hotkey")
        self.toggle()

    def application_state_changed(self, state):
        trace_event("application_state", state=state.value, visible=self.visible)
        if state != Qt.ApplicationState.ApplicationActive:
            for overlay in self.overlays:
                overlay.cancel_gesture()
        # Activation can also arrive after hiding windows or opening a tray
        # menu. Only an explicit toggle/show request may leave the OFF state.

    def refresh(self):
        for overlay in self.overlays:
            overlay.refresh()
        self.toggle_action.setText(("필기 끄기" if self.visible else "필기 켜기")
                                  + " (" + binding_label(self.prefs.shortcuts["toggle"]) + ")")

    def persist(self):
        try:
            self.prefs.save()
            return True
        except OSError as error:
            for overlay in self.overlays:
                overlay.status.setText("설정을 저장할 수 없습니다: " + str(error))
            return False

    def select_tool(self, tool):
        for overlay in self.overlays:
            overlay.commit_text()
        self.tool = tool
        self.refresh()
        self.active_overlay().setFocus()

    def set_color(self, color):
        self.prefs.color = color
        for overlay in self.overlays:
            if overlay.draft:
                overlay.draft.color = color
                overlay.style_editor()
        self.persist()
        self.refresh()

    def set_width(self, width):
        self.prefs.width = min(32,max(1,width))
        self.persist()
        self.refresh()

    def set_font_size(self, size):
        self.prefs.font_size = min(144,max(12,size))
        for overlay in self.overlays:
            if overlay.draft:
                overlay.draft.font_size = self.prefs.font_size
                overlay.style_editor()
        self.persist()
        self.refresh()

    def open_settings(self):
        if self.dialog:
            self.dialog.raise_()
            return
        if not self.visible:
            self.show()
        for overlay in self.overlays:
            overlay.cancel_gesture()
            overlay.commit_text()
        self.dialog = ShortcutDialog(self, self.active_overlay())
        self.dialog.exec()
        self.dialog = None
        self.refresh()

    def apply_shortcuts(self, values):
        error = validate_shortcuts(values)
        if error:
            return False, error
        old = self.prefs.shortcuts
        success, message = self.integration.register_hotkey(values["toggle"])
        if not success:
            return False, message
        self.prefs.shortcuts = copy.deepcopy(values)
        if not self.persist():
            self.prefs.shortcuts = old
            self.hotkey_registered, self.registration_error = self.integration.register_hotkey(old["toggle"])
            return False, "설정을 저장하지 못해 변경을 적용하지 않았습니다."
        self.hotkey_registered = True
        self.refresh()
        return True, ""

    def eventFilter(self, watched, event):
        if event.type() == QEvent.Type.KeyPress:
            trace_event("key", key=event.key(), native=event.nativeVirtualKey(),
                        modifiers=physical_modifiers(event.modifiers()), binding=event_binding(event))
        if event.type() == QEvent.Type.KeyRelease:
            if not physical_modifiers(event.modifiers())["ctrl"]:
                for overlay in self.overlays:
                    if overlay.gesture and overlay.gesture["type"] == "delete":
                        overlay.cancel_gesture()
        if event.type() != QEvent.Type.KeyPress or not self.visible or self.dialog or QApplication.activeModalWidget():
            return False
        if isinstance(watched, (QPlainTextEdit, QLineEdit, QAbstractSpinBox)):
            return False
        if event.isAutoRepeat() or any(o.editor.composing for o in self.overlays):
            return False
        if event.key() == Qt.Key.Key_Escape:
            for overlay in self.overlays:
                if overlay.gesture:
                    overlay.cancel_gesture()
                    return True
                if overlay.draft:
                    overlay.cancel_text()
                    return True
            self.hide()
            return True
        value = event_binding(event)
        if not value:
            return False
        action = next((name for name,_ in ACTIONS if signature(value) == signature(self.prefs.shortcuts[name])), None)
        if action == "toggle":
            # Exclusive global hotkeys are consumed by the OS. Also support
            # app-local events (e.g. accessibility input) while this app has focus.
            self.toggle()
            return True
        if action in ("pen","rect","text"):
            self.select_tool(action)
        elif action == "increase":
            self.set_width(self.prefs.width+1)
        elif action == "decrease":
            self.set_width(self.prefs.width-1)
        elif action == "settings":
            self.open_settings()
        else:
            return False
        return True


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("MyBrush")
    app.setApplicationDisplayName("My Brush")
    app.setOrganizationName("MyBrush")
    app.setWindowIcon(app_icon())
    app.setQuitOnLastWindowClosed(False)
    socket = QLocalSocket()
    server_name = "dev.mybrush.desktop." + str(os.getuid() if hasattr(os,"getuid") else os.getenv("USERNAME","user"))
    socket.connectToServer(server_name)
    if socket.waitForConnected(250):
        socket.write(b"show")
        socket.waitForBytesWritten(500)
        return 0
    QLocalServer.removeServer(server_name)
    server = QLocalServer(app)
    if not server.listen(server_name):
        QMessageBox.critical(None,"My Brush","앱 실행 잠금을 만들지 못했습니다: " + server.errorString())
        return 1
    controller = Controller(app)

    def new_connection():
        client = server.nextPendingConnection()
        if client:
            client.disconnectFromServer()
            client.deleteLater()
        controller.show()

    server.newConnection.connect(new_connection)
    app.aboutToQuit.connect(server.close)
    if "--start-hidden" not in sys.argv:
        QTimer.singleShot(0, controller.show)
    return app.exec()
