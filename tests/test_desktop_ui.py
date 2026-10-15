"""Qt widget integration checks; OS integration is deliberately replaced.

Run with QT_QPA_PLATFORM=offscreen. These checks do not establish real desktop
transparency, focus restoration, global shortcut delivery, or an OS IME session.
"""

import copy
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent, QObject, QPoint, QPointF, Qt, Signal
from PySide6.QtGui import QInputMethodEvent, QKeyEvent, QMouseEvent
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication, QDialog

from my_brush.app import Controller, ShortcutDialog, text_bounds
from my_brush.model import Rectangle, Stroke, Text
from my_brush.preferences import Preferences, binding, event_binding, physical_modifiers, validate_shortcuts


CONTROL = Qt.KeyboardModifier.MetaModifier if sys.platform == "darwin" else Qt.KeyboardModifier.ControlModifier
COMMAND = Qt.KeyboardModifier.ControlModifier if sys.platform == "darwin" else Qt.KeyboardModifier.MetaModifier
NO_MODIFIERS = Qt.KeyboardModifier.NoModifier
LEFT = Qt.MouseButton.LeftButton


class FakeDesktopIntegration(QObject):
    hotkeyActivated = Signal()

    def __init__(self):
        super().__init__()
        self.registrations = []
        self.fail_registration = False
        self.foreground_token = ("external-app", 1234)
        self.restored = []

    def register_hotkey(self, value):
        self.registrations.append(copy.deepcopy(value))
        return (False, "test: occupied hotkey") if self.fail_registration else (True, "")

    def foreground_app(self):
        return self.foreground_token

    def restore_foreground(self, token):
        self.restored.append(token)

    def configure_overlay(self, overlay):
        pass

    def activate_app(self):
        pass

    def close(self):
        pass


class DesktopWidgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])
        cls.app.setQuitOnLastWindowClosed(False)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="my-brush-widget-tests-")
        self.path = Path(self.directory.name) / "preferences.json"
        self.integration = FakeDesktopIntegration()
        self.controller = Controller(self.app, Preferences(self.path), self.integration)
        self.controller.show()
        self.app.processEvents()
        self.overlay = self.controller.active_overlay()
        self.scene = self.overlay.scene

    def tearDown(self):
        if self.controller.dialog:
            self.controller.dialog.reject()
            self.controller.dialog = None
        self.controller.hide()
        self.controller.tray.hide()
        self.app.removeEventFilter(self.controller)
        self.app.applicationStateChanged.disconnect(self.controller.application_state_changed)
        self.app.aboutToQuit.disconnect(self.integration.close)
        # Controller installs screen callbacks as lambdas. This isolated test
        # QApplication has no other screen subscribers to preserve.
        self.app.screenAdded.disconnect()
        self.app.screenRemoved.disconnect()
        for overlay in self.controller.overlays:
            overlay.deleteLater()
        self.controller.deleteLater()
        self.integration.deleteLater()
        self.app.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        self.app.processEvents()
        self.directory.cleanup()

    def move(self, point, modifiers=NO_MODIFIERS):
        local = QPointF(*point)
        global_point = QPointF(self.overlay.mapToGlobal(QPoint(*point)))
        event = QMouseEvent(QEvent.Type.MouseMove, local, global_point,
                            Qt.MouseButton.NoButton, LEFT, modifiers)
        self.app.sendEvent(self.overlay, event)

    def press(self, point, modifiers=NO_MODIFIERS):
        QTest.mousePress(self.overlay, LEFT, modifiers, QPoint(*point))

    def release(self, point, modifiers=NO_MODIFIERS):
        QTest.mouseRelease(self.overlay, LEFT, modifiers, QPoint(*point))

    def drag(self, start, end, modifiers=NO_MODIFIERS):
        self.press(start, modifiers)
        self.move(end, modifiers)
        self.release(end, modifiers)

    def key(self, key, modifiers=NO_MODIFIERS, target=None):
        QTest.keyClick(target or self.overlay, key, modifiers)

    def open_text(self, point=(200, 220)):
        self.controller.select_tool("text")
        QTest.mouseClick(self.overlay, LEFT, NO_MODIFIERS, QPoint(*point))
        self.assertIsNotNone(self.overlay.draft)
        return self.overlay.editor

    def dialog(self):
        dialog = ShortcutDialog(self.controller, self.overlay)
        self.controller.dialog = dialog
        dialog.show()
        self.app.processEvents()
        return dialog

    def test_pen_and_reverse_rectangle_create_separate_native_scene_objects(self):
        self.drag((200, 220), (260, 250))
        self.key(Qt.Key.Key_R)
        self.drag((400, 360), (320, 280))
        self.assertEqual(len(self.scene.objects), 2)
        stroke, rectangle = self.scene.objects
        self.assertIsInstance(stroke, Stroke)
        self.assertEqual(stroke.points, [(200.0, 220.0), (260.0, 250.0)])
        self.assertIsInstance(rectangle, Rectangle)
        self.assertEqual((rectangle.x, rectangle.y, rectangle.width, rectangle.height), (320, 280, 80, 80))
        self.assertNotEqual(stroke.id, rectangle.id)

    def test_active_stroke_keeps_initial_tool_color_and_width(self):
        original_color = self.controller.prefs.color
        self.press((200, 220))
        self.controller.set_color("#628EBE")
        self.controller.set_width(12)
        self.key(Qt.Key.Key_R)
        self.move((260, 250))
        self.release((260, 250))
        self.drag((320, 280), (400, 360))
        stroke, rectangle = self.scene.objects
        self.assertIsInstance(stroke, Stroke)
        self.assertEqual((stroke.color, stroke.width), (original_color, 4))
        self.assertEqual((rectangle.color, rectangle.line_width), ("#628EBE", 12))

    def test_rectangle_style_is_captured_at_press(self):
        self.controller.select_tool("rect")
        self.press((200, 220))
        self.controller.set_width(20)
        self.controller.set_color("#E26159")
        self.release((280, 290))
        rectangle = self.scene.objects[0]
        self.assertEqual(rectangle.line_width, 4)
        self.assertNotEqual(rectangle.color, "#E26159")

    def test_multiline_korean_text_commits_using_control_enter(self):
        editor = self.open_text()
        commit = QInputMethodEvent()
        commit.setCommitString("한글 화면")
        self.app.sendEvent(editor, commit)
        QTest.qWait(35)
        self.key(Qt.Key.Key_Return, target=editor)
        editor.insertPlainText("둘째 줄")
        self.key(Qt.Key.Key_Return, CONTROL, editor)
        self.assertIsNone(self.overlay.draft)
        self.assertEqual(self.scene.objects[0].text, "한글 화면\n둘째 줄")
        self.assertGreater(text_bounds(self.scene.objects[0])[3], 28)

    def test_text_tool_keys_remain_normal_editor_input(self):
        editor = self.open_text()
        QTest.keyClicks(editor, "brt[]")
        self.assertEqual(editor.toPlainText(), "brt[]")
        self.assertEqual(self.controller.tool, "text")
        self.assertEqual(self.controller.prefs.width, 4)

    def test_existing_text_resize_and_color_can_be_cancelled(self):
        original = Text("original", 200, 220, "기존 텍스트", "#334A42", 28)
        self.scene.add(original)
        editor = self.open_text()
        editor.setPlainText("수정 중")
        self.controller.set_font_size(72)
        self.controller.set_color("#E26159")
        self.assertEqual((self.overlay.draft.font_size, self.overlay.draft.color), (72, "#E26159"))
        self.key(Qt.Key.Key_Escape, target=editor)
        self.assertIs(self.scene.objects[0], original)
        self.assertEqual((original.text, original.font_size, original.color), ("기존 텍스트", 28, "#334A42"))
        self.assertTrue(self.controller.visible)

    def test_existing_text_resize_commit_and_empty_commit_removal(self):
        self.scene.add(Text("existing", 200, 220, "이전", "#334A42", 28))
        editor = self.open_text()
        editor.setPlainText("변경")
        self.controller.set_font_size(60)
        self.key(Qt.Key.Key_Return, CONTROL, editor)
        self.assertEqual((self.scene.objects[0].text, self.scene.objects[0].font_size), ("변경", 60))
        editor = self.open_text()
        editor.clear()
        self.key(Qt.Key.Key_Return, CONTROL, editor)
        self.assertEqual(self.scene.objects, [])

    def test_ime_composition_shields_shortcuts_commit_cancel_and_global_toggle(self):
        editor = self.open_text()
        self.app.sendEvent(editor, QInputMethodEvent("ㅎ", []))
        self.assertTrue(editor.composing)
        self.key(Qt.Key.Key_R)
        self.key(Qt.Key.Key_Escape, target=editor)
        self.key(Qt.Key.Key_Return, CONTROL, editor)
        self.integration.hotkeyActivated.emit()
        self.assertEqual(self.controller.tool, "text")
        self.assertTrue(self.controller.visible)
        self.assertIsNotNone(self.overlay.draft)
        self.assertEqual(self.scene.objects, [])

    def test_outside_click_commits_text_and_consumes_that_click(self):
        editor = self.open_text()
        editor.setPlainText("확정")
        QTest.mouseClick(self.overlay, LEFT, NO_MODIFIERS, QPoint(500, 400))
        self.assertIsNone(self.overlay.draft)
        self.assertEqual(len(self.scene.objects), 1)
        self.assertIsNone(self.overlay.gesture)
        QTest.mouseClick(self.overlay, LEFT, NO_MODIFIERS, QPoint(500, 400))
        self.assertIsNotNone(self.overlay.draft)

    def test_control_drag_previews_then_deletes_whole_mixed_objects(self):
        self.scene.add(Stroke("stroke", [(180, 260), (500, 260)], "#334A42", 4))
        self.scene.add(Rectangle("rectangle", 300, 240, 80, 100, "#334A42", 4))
        self.scene.add(Text("text", 302, 252, "텍스트", "#334A42", 28))
        self.scene.add(Rectangle("safe", 600, 450, 50, 50, "#334A42", 4))
        self.press((299, 251), CONTROL)
        self.move((310, 265), CONTROL)
        self.assertEqual(self.overlay.deletion_targets(), {"stroke", "rectangle", "text"})
        self.assertEqual(len(self.scene.objects), 4)
        self.release((310, 265), CONTROL)
        self.assertEqual([obj.id for obj in self.scene.objects], ["safe"])
        self.assertEqual(self.controller.tool, "pen")

    def test_releasing_control_before_mouse_cancels_deletion(self):
        original = Stroke("safe", [(200, 220), (300, 250)], "#334A42", 4)
        self.scene.add(original)
        self.press((190, 210), CONTROL)
        self.move((310, 260), CONTROL)
        # QKeyEvent toggles the modifier matching its own key in modifiers().
        # Supply its pre-release state so the delivered state is released.
        event = QKeyEvent(QEvent.Type.KeyRelease, Qt.Key.Key_Meta if sys.platform == "darwin" else Qt.Key.Key_Control, CONTROL)
        self.assertFalse(physical_modifiers(event.modifiers())["ctrl"])
        self.app.sendEvent(self.overlay, event)
        self.assertIsNone(self.overlay.gesture)
        self.release((310, 260))
        self.assertEqual(self.scene.objects, [original])

    def test_escape_cancels_only_active_delete_then_returns_to_work(self):
        original = Stroke("safe", [(200, 220)], "#334A42", 4)
        self.scene.add(original)
        self.press((190, 210), CONTROL)
        self.move((210, 230), CONTROL)
        self.key(Qt.Key.Key_Escape)
        self.release((210, 230), CONTROL)
        self.assertTrue(self.controller.visible)
        self.assertIsNone(self.overlay.gesture)
        self.assertEqual(self.scene.objects, [original])
        self.key(Qt.Key.Key_Escape)
        self.assertFalse(self.controller.visible)
        self.assertEqual(self.integration.restored[-1], self.integration.foreground_token)

    def test_hide_cancels_active_draw_and_delete_without_late_commit(self):
        for modifiers in (NO_MODIFIERS, CONTROL):
            with self.subTest(modifiers=modifiers):
                self.controller.show()
                self.scene.objects[:] = [Stroke("keep", [(200, 220)], "#334A42", 4)]
                self.press((190, 210), modifiers)
                self.move((260, 270), modifiers)
                self.controller.hide()
                self.release((260, 270), modifiers)
                self.controller.show()
                self.assertIsNone(self.overlay.gesture)
                self.assertEqual([obj.id for obj in self.scene.objects], ["keep"])

    def test_hide_commits_draft_and_toggle_preserves_session_objects(self):
        editor = self.open_text()
        editor.setPlainText("세션 보존")
        self.integration.hotkeyActivated.emit()
        self.assertFalse(self.controller.visible)
        self.assertEqual(self.scene.objects[0].text, "세션 보존")
        self.integration.hotkeyActivated.emit()
        self.assertTrue(self.controller.visible)
        self.assertEqual(len(self.scene.objects), 1)

    def test_focus_loss_cancels_incomplete_gesture(self):
        self.press((200, 220))
        self.move((250, 260))
        self.controller.application_state_changed(Qt.ApplicationState.ApplicationInactive)
        self.release((250, 260))
        self.assertIsNone(self.overlay.gesture)
        self.assertEqual(self.scene.objects, [])

    def test_duplicate_shortcuts_block_save_without_changing_preferences(self):
        original = copy.deepcopy(self.controller.prefs.shortcuts)
        dialog = self.dialog()
        QTest.mouseClick(dialog.buttons["rect"], LEFT)
        self.key(Qt.Key.Key_B, target=dialog.buttons["rect"])
        self.assertFalse(dialog.save_button.isEnabled())
        dialog.save()
        self.assertIn("같습니다", dialog.message.text())
        self.assertEqual(self.controller.prefs.shortcuts, original)
        self.assertEqual(len(self.integration.registrations), 1)

    def test_shortcut_recording_save_updates_controller_and_disk(self):
        dialog = self.dialog()
        QTest.mouseClick(dialog.buttons["rect"], LEFT)
        self.key(Qt.Key.Key_F8, target=dialog.buttons["rect"])
        self.assertTrue(dialog.save_button.isEnabled())
        QTest.mouseClick(dialog.save_button, LEFT)
        self.assertEqual(dialog.result(), QDialog.DialogCode.Accepted)
        self.controller.dialog = None
        self.key(Qt.Key.Key_F8)
        self.assertEqual(self.controller.tool, "rect")
        self.assertEqual(Preferences(self.path).shortcuts["rect"], binding("F8"))

    def test_escape_cancels_recording_then_dialog_cancel_discards_draft(self):
        dialog = self.dialog()
        original = copy.deepcopy(self.controller.prefs.shortcuts)
        QTest.mouseClick(dialog.buttons["rect"], LEFT)
        self.key(Qt.Key.Key_Escape, target=dialog.buttons["rect"])
        self.assertIsNone(dialog.recording)
        self.assertTrue(dialog.isVisible())
        QTest.mouseClick(dialog.buttons["rect"], LEFT)
        self.key(Qt.Key.Key_F8, target=dialog.buttons["rect"])
        dialog.reject()
        self.assertEqual(self.controller.prefs.shortcuts, original)

    def test_failed_global_registration_keeps_previous_binding(self):
        old = copy.deepcopy(self.controller.prefs.shortcuts)
        values = copy.deepcopy(old)
        values["toggle"] = binding("F8", ctrl=True)
        self.integration.fail_registration = True
        success, error = self.controller.apply_shortcuts(values)
        self.assertFalse(success)
        self.assertIn("occupied", error)
        self.assertEqual(self.controller.prefs.shortcuts, old)

    def test_preferences_round_trip_restores_styles_and_shortcuts(self):
        self.controller.set_width(9)
        self.controller.set_color("#628EBE")
        self.controller.set_font_size(56)
        values = copy.deepcopy(self.controller.prefs.shortcuts)
        values["pen"] = binding("F9", alt=True)
        self.assertTrue(self.controller.apply_shortcuts(values)[0])
        loaded = Preferences(self.path)
        self.assertEqual((loaded.width, loaded.color, loaded.font_size), (9, "#628EBE", 56))
        self.assertEqual(loaded.shortcuts["pen"], binding("F9", alt=True))

    def test_physical_control_is_distinct_from_command_on_mac(self):
        values = physical_modifiers(CONTROL)
        self.assertTrue(values["ctrl"])
        self.assertFalse(values["meta"])
        if sys.platform == "darwin":
            command = physical_modifiers(Qt.KeyboardModifier.ControlModifier)
            self.assertTrue(command["meta"])
            self.assertFalse(command["ctrl"])

    @unittest.skipUnless(sys.platform == "darwin", "macOS physical key mapping")
    def test_mac_hardware_key_mapping_survives_korean_layout_text(self):
        event = QKeyEvent(QEvent.Type.KeyPress, Qt.Key.Key_unknown, NO_MODIFIERS,
                          15, 15, 1, "ㄱ")
        self.assertEqual(event_binding(event), binding("R"))

    def test_modifier_and_fixed_keys_with_native_metadata_never_bind_as_a(self):
        keys = (Qt.Key.Key_Shift, Qt.Key.Key_Control, Qt.Key.Key_Meta, Qt.Key.Key_Alt,
                Qt.Key.Key_AltGr, Qt.Key.Key_CapsLock, Qt.Key.Key_NumLock,
                Qt.Key.Key_ScrollLock, Qt.Key.Key_Escape, Qt.Key.Key_Return, Qt.Key.Key_Enter)
        for key in keys:
            for event_type in (QEvent.Type.KeyPress, QEvent.Type.KeyRelease):
                with self.subTest(key=key, event_type=event_type):
                    # macOS virtual key zero normally identifies A, but native
                    # modifier/fixed-key events may contain zero plus flags.
                    event = QKeyEvent(event_type, key, NO_MODIFIERS, 0, 0, 1)
                    self.assertIsNone(event_binding(event))

    @unittest.skipUnless(sys.platform == "darwin", "macOS physical key mapping")
    def test_actual_hardware_a_and_b_remain_bindable_with_native_metadata(self):
        for virtual_key, text, expected in ((0, "ㅁ", "A"), (11, "ㅠ", "B")):
            with self.subTest(virtual_key=virtual_key):
                event = QKeyEvent(QEvent.Type.KeyPress, Qt.Key.Key_unknown,
                                  NO_MODIFIERS, 0, virtual_key, 1, text)
                self.assertEqual(event_binding(event), binding(expected))

    def test_accessibility_like_checked_state_selects_tool_and_stays_exclusive(self):
        buttons = self.overlay.toolbar.tool_buttons
        buttons["rect"].setChecked(True)
        self.assertEqual(self.controller.tool, "rect")
        self.assertFalse(buttons["pen"].isChecked())
        QTest.mouseClick(buttons["rect"], LEFT)
        self.assertTrue(buttons["rect"].isChecked())
        self.assertEqual(self.controller.tool, "rect")
        buttons["text"].setChecked(True)
        self.assertEqual(self.controller.tool, "text")
        self.assertEqual(sum(button.isChecked() for button in buttons.values()), 1)

    def test_local_toggle_key_hides_and_native_callback_shows(self):
        if sys.platform == "darwin":
            self.key(Qt.Key.Key_Tab, CONTROL | COMMAND)
        else:
            self.key(Qt.Key.Key_Space, CONTROL | Qt.KeyboardModifier.ShiftModifier)
        self.assertFalse(self.controller.visible)
        self.integration.hotkeyActivated.emit()
        self.assertTrue(self.controller.visible)
        self.assertTrue(self.overlay.isVisible())

    def test_global_callback_during_recording_records_binding_without_hiding(self):
        original = copy.deepcopy(self.controller.prefs.shortcuts)
        dialog = self.dialog()
        QTest.mouseClick(dialog.buttons["text"], LEFT)
        self.integration.hotkeyActivated.emit()
        self.assertIsNone(dialog.recording)
        self.assertEqual(dialog.values["text"], original["toggle"])
        self.assertFalse(dialog.save_button.isEnabled())
        self.assertTrue(self.controller.visible)
        self.assertTrue(dialog.isVisible())
        self.assertEqual(self.controller.prefs.shortcuts, original)

    def test_global_callback_is_ignored_while_other_modal_dialog_is_open(self):
        modal = QDialog(self.overlay)
        modal.open()
        self.app.processEvents()
        self.assertIs(QApplication.activeModalWidget(), modal)
        self.integration.hotkeyActivated.emit()
        self.assertTrue(self.controller.visible)
        self.assertTrue(modal.isVisible())
        modal.reject()

    def test_right_button_release_does_not_commit_left_button_drawing(self):
        self.press((200, 220))
        self.move((260, 250))
        QTest.mousePress(self.overlay, Qt.MouseButton.RightButton, NO_MODIFIERS, QPoint(260, 250))
        QTest.mouseRelease(self.overlay, Qt.MouseButton.RightButton, NO_MODIFIERS, QPoint(260, 250))
        self.assertIsNotNone(self.overlay.gesture)
        self.assertEqual(self.scene.objects, [])
        self.release((280, 260))
        self.assertEqual(len(self.scene.objects), 1)
        self.assertEqual(self.scene.objects[0].points[-1], (280, 260))

    def test_losing_mouse_grab_cancels_without_late_commit(self):
        self.press((200, 220))
        self.move((260, 250))
        self.app.sendEvent(self.overlay, QEvent(QEvent.Type.UngrabMouse))
        self.assertIsNone(self.overlay.gesture)
        self.release((280, 260))
        self.assertEqual(self.scene.objects, [])

    def test_blank_overlay_raster_has_only_one_alpha_input_layer(self):
        self.assertTrue(self.overlay.testAttribute(Qt.WidgetAttribute.WA_TranslucentBackground))
        image = self.overlay.grab().toImage()
        self.assertEqual(image.pixelColor(10, 150).alpha(), 1)

    def test_application_activation_keeps_overlay_off_until_explicit_toggle(self):
        captured = self.controller.previous_app
        self.scene.add(Stroke("keep", [(200, 220), (260, 250)], "#334A42", 4))
        self.controller.hide()
        for _ in range(3):
            self.controller.application_state_changed(Qt.ApplicationState.ApplicationInactive)
            self.controller.application_state_changed(Qt.ApplicationState.ApplicationActive)
            self.app.processEvents()
            self.assertFalse(self.controller.visible)
            self.assertFalse(self.overlay.isVisible())
            self.assertFalse(self.overlay.toolbar.isVisible())
        self.assertEqual([obj.id for obj in self.scene.objects], ["keep"])
        self.assertEqual(self.controller.previous_app, captured)
        self.integration.hotkeyActivated.emit()
        self.assertTrue(self.controller.visible)
        self.assertTrue(self.overlay.toolbar.isVisible())
        self.assertEqual([obj.id for obj in self.scene.objects], ["keep"])

    def test_modified_tab_can_be_recorded_saved_and_restored(self):
        expected = binding("Tab", ctrl=True, meta=True)
        dialog = self.dialog()
        QTest.mouseClick(dialog.buttons["toggle"], LEFT)
        self.key(Qt.Key.Key_Tab, CONTROL | COMMAND, target=dialog.buttons["toggle"])
        self.assertIsNone(dialog.recording)
        self.assertEqual(dialog.values["toggle"], expected)
        self.assertEqual(validate_shortcuts(dialog.values), "")
        self.assertTrue(dialog.save_button.isEnabled())
        QTest.mouseClick(dialog.save_button, LEFT)
        self.assertEqual(dialog.result(), QDialog.DialogCode.Accepted)
        self.assertEqual(self.integration.registrations[-1], expected)
        self.assertEqual(Preferences(self.path).shortcuts["toggle"], expected)

    @unittest.skipUnless(sys.platform == "darwin", "macOS physical Tab key mapping")
    def test_native_control_command_tab_maps_to_requested_physical_binding(self):
        event = QKeyEvent(QEvent.Type.KeyPress, Qt.Key.Key_Tab, CONTROL | COMMAND,
                          0, 48, 0x140000, "\t")
        self.assertEqual(event_binding(event), binding("Tab", ctrl=True, meta=True))


if __name__ == "__main__":
    unittest.main()
